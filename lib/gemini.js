const Gemini = {
  API_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',

  async call(apiKey, prompt, jsonMode = false, schema = null) {
    const body = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    if (jsonMode) {
      body.generationConfig = {
        responseMimeType: 'application/json'
      };
      if (schema) {
        body.generationConfig.responseSchema = schema;
      }
    }

    let lastError;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const response = await fetch(`${this.API_BASE}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 429 && attempt < 4) {
            lastError = new Error(`Gemini API error (429): ${errorText}`);
            // Wait 4s, 8s, 12s
            await new Promise(resolve => setTimeout(resolve, attempt * 4000));
            continue;
          }
          if (response.status === 429) {
            throw new Error(`Gemini API error (429): You have exceeded your Gemini API rate limit. If you are on the free tier, you may have hit the 15 Requests Per Minute limit, or the 1,500 Requests Per Day limit. Please wait a minute and try again. Original Error: ${errorText}`);
          }
          if (response.status === 404) {
            throw new Error(`Gemini API error (404): The requested model was not found. Please verify your API URL endpoints.`);
          }
          throw new Error(`Gemini API error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('No response from Gemini');
        return text;
      } catch (err) {
        if (err.message.includes('429') && attempt < 4) {
          lastError = err;
          await new Promise(resolve => setTimeout(resolve, attempt * 4000));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  },

  async analyzeResume(apiKey, resumeText) {
    if (resumeText && resumeText.length > 15000) {
      resumeText = resumeText.substring(0, 15000) + '\n[TRUNCATED]';
    }

    const prompt = `Analyze this resume and extract structured information. Return a JSON object with these fields:
{
  "fullName": "",
  "firstName": "",
  "lastName": "",
  "email": "",
  "phone": "",
  "address": { "street": "", "city": "", "state": "", "zip": "", "country": "" },
  "linkedinUrl": "",
  "githubUrl": "",
  "portfolioUrl": "",
  "education": [{ "school": "", "degree": "", "field": "", "graduationDate": "", "gpa": "" }],
  "experience": [{ "company": "", "title": "", "startDate": "", "endDate": "", "description": "" }],
  "skills": [],
  "yearsOfExperience": 0,
  "summary": ""
}

Fill in what you can find. Leave empty strings for missing fields. For yearsOfExperience, calculate from work history.

RESUME:
${resumeText}`;

    const result = await this.call(apiKey, prompt, true);
    return JSON.parse(result);
  },

  async answerFields(apiKey, fields, resumeText, profile, jobDescription, customInstructions = null) {
    const questionsBlock = fields
      .map((f, i) => `${i + 1}. [${f.id}] "${f.label}"${f.fieldType ? ` [type: ${f.fieldType}]` : ''}${f.options ? ` (options: ${f.options.join(', ')})` : ''}`)
      .join('\n');

    // Dynamically build the JSON schema to force exact matches
    const properties = {};
    fields.forEach(f => {
      if (f.options && f.options.length > 0) {
        properties[f.id] = { type: "string", enum: f.options };
      } else if (f.fieldType === 'checkbox-group') {
        // Return comma separated string, not array for compatibility with form-filler
        properties[f.id] = { type: "string" }; 
      } else {
        properties[f.id] = { type: "string" };
      }
    });

    const schema = {
      type: "OBJECT",
      properties: properties
    };

    const prompt = `You are the applicant (Stephen Skalamera) filling out a job application. Given your resume and profile, answer each question concisely and professionally IN THE FIRST PERSON ("I", "my", "me"). NEVER refer to the applicant in the third person ("Stephen", "he", "his"). Output ONLY the actual answer text. Do not include any preambles, labels, quotation marks, or surrounding conversational text.

RESUME:
${resumeText}

PROFILE:
${JSON.stringify(profile, null, 2)}

${jobDescription ? `JOB DESCRIPTION:\n${jobDescription}\n` : ''}

${customInstructions ? `CUSTOM INSTRUCTIONS FROM APPLICANT:\n${customInstructions}\n` : ''}

WRITING & TONE RULES FOR TEXT FIELDS:
- Position: "I'm choosing you." - the candidate has options and is choosing this company for concrete reasons.
- Specific and concrete: Always reference something REAL from the JD or company, and something REAL from the candidate's experience.
- Direct, no fluff: 1-3 sentences per answer. No "I'm passionate about..." or "I would love the opportunity to...". Vary sentence rhythm.
- The hook is the proof, not the claim: Instead of "I'm great at X", say "I built X that does Y".
- NEVER use em dashes (-). Use commas, colons, semicolons, or rewrite the sentence instead.
- Short sentences, active voice, specific metrics where possible.
- Mirror the exact JD language and requirements when applicable.
- BANNED VOCABULARY: delve, realm, harness, unlock, tapestry, paradigm, cutting-edge, revolutionize, intricate, crucial, pivotal, leverage, synergy, innovative, game-changer, seamless, robust, empower, elevate.
- BANNED PHRASES: "I am eager", "serves as", "boasts a", "features a", "In today's...", "Furthermore", "Additionally", "Moreover". Use plain verbs (is, has, uses).
- NO NEGATIVE PARALLELISM: Do not use "Not X, but Y", "It isn't X. It's Y". Just state the positive claim directly.
- NO ANALOGIES OR METAPHORS: Write literally. Do not use words like "bridge", "lens", "engine", "journey".

INSTRUCTIONS FOR SPECIFIC FIELD TYPES:
For any field with options listed, you MUST return the provided option text exactly as written.
For checkbox-group fields, return a comma-separated list of the exact options that should be checked. If only one option applies, return just that option text.
For yes/no questions, respond with just "Yes" or "No".
For plain eligibility questions (e.g. "legally authorized to work", "eligible to work in X") that expect Yes or No, answer only "Yes" or "No". Do NOT use work-authorization phrases like "Can work for any employer" unless that exact phrase appears as one of the listed options for that field.
For text fields, give a concise, professional answer IN THE FIRST PERSON based on the Writing & Tone rules above. Do not use the applicant's name unless explicitly asked for a signature/name.
If you cannot determine the answer from the resume/profile, provide a reasonable professional response in the first person.
Never answer an option label with "Yes" or "No" unless the actual listed option is exactly "Yes" or exactly "No".

QUESTIONS:
${questionsBlock}`;

    const result = await this.call(apiKey, prompt, true, schema);
    return JSON.parse(result);
  },

  async generateCoverLetter(apiKey, resumeText, jobDescription, companyName, roleTitle) {
    const prompt = `Write a professional cover letter for this job application.

APPLICANT RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription || 'Not available - write a general cover letter based on the resume.'}

COMPANY: ${companyName || 'the company'}
ROLE: ${roleTitle || 'the position'}

Requirements:
- Professional but personable tone, written in the first person ("I", "my").
- 3-4 paragraphs. Use short paragraphs (1-2 sentences). Vary sentence rhythm.
- Highlight relevant experience from the resume with specific metrics.
- Confident and selective tone: the candidate is choosing this role for concrete reasons.
- Keep under 400 words.
- Do NOT include placeholder brackets like [Company Name] - use the actual names provided.
- After the final paragraph, add ONE MORE separate paragraph containing exactly and only: "Thank you for considering my application. My portfolio can be found at skalamera.me." And make the url hyperlinked to https://bit.ly/skalamera-portfolio.
- Start with "Dear Hiring Manager," and end with "Sincerely," followed by the applicant's name.
- Formatting: Never use em dashes. Use commas, colons, or parentheses.
- BANNED VOCABULARY: delve, realm, harness, unlock, tapestry, paradigm, cutting-edge, revolutionize, intricate, crucial, pivotal, leverage, synergy, innovative, game-changer, seamless, robust, empower, elevate.
- BANNED PHRASES: "I am eager", "serves as", "boasts a", "features a", "In today's...", "Furthermore", "Additionally", "Moreover". Use plain verbs (is, has, uses).
- NO NEGATIVE PARALLELISM: Do not use "Not X, but Y", "It isn't X. It's Y". Just state the positive claim directly.
- NO ANALOGIES OR METAPHORS: Write literally. Do not use words like "bridge", "lens", "engine", "journey".`;

    return await this.call(apiKey, prompt, false);
  }
};
