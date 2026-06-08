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
            await new Promise(resolve => setTimeout(resolve, attempt * 4000));
            continue;
          }
          if (response.status === 429) {
            throw new Error(`Gemini API error (429): Exceeded Gemini API rate limit. If on the free tier, wait a minute and try again. Original Error: ${errorText}`);
          }
          if (response.status === 404) {
            throw new Error(`Gemini API error (404): The requested model was not found.`);
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
    // Sanitize property names for Gemini schema (only alphanumeric/underscore/hyphen, must start with alpha)
    const sanitizeId = (id) => {
      let safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (!/^[a-zA-Z0-9]/.test(safe)) {
        safe = 'f_' + safe;
      }
      return safe;
    };

    const idMapping = {};
    const sanitizedFields = fields.map(f => {
      const sId = sanitizeId(f.id);
      idMapping[sId] = f.id;
      return { ...f, id: sId };
    });

    const questionsBlock = sanitizedFields
      .map((f, i) => `${i + 1}. [${f.id}] "${f.label}"${f.fieldType ? ` [type: ${f.fieldType}]` : ''}${f.options ? ` (options: ${f.options.join(', ')})` : ''}`)
      .join('\n');

    const properties = {};
    sanitizedFields.forEach(f => {
      if (f.options && f.options.length > 0 && f.options.length <= 15) {
        properties[f.id] = { type: "string", enum: f.options };
      } else {
        properties[f.id] = { type: "string" };
      }
    });

    const schema = {
      type: "OBJECT",
      properties: properties
    };

    const prompt = `You are the applicant filling out a job application. Given your resume and profile, answer each question concisely and professionally IN THE FIRST PERSON ("I", "my", "me"). NEVER refer to the applicant in the third person. Output ONLY the actual answer text. Do not include any preambles, labels, quotation marks, or surrounding conversational text.

RESUME:
${resumeText}

PROFILE:
${JSON.stringify(profile, null, 2)}

${jobDescription ? `JOB DESCRIPTION:\n${jobDescription}\n` : ''}

${customInstructions ? `CUSTOM INSTRUCTIONS FROM APPLICANT:\n${customInstructions}\n` : ''}

WRITING & TONE RULES FOR TEXT FIELDS:
- Direct and proof-focused: 1-3 sentences per answer. No fluff (e.g. avoid "I'm passionate about", "I would love the opportunity to").
- Specific: Reference real facts from your resume and real details from the job description when applicable.
- Mirror the language and vocabulary of the question and job description.
- Never use em dashes. Use commas, colons, or separate sentences.
- NEVER include thinking process, reasoning, justifications, parenthesis explaining choices, or note to user. Return ONLY the clean, final value.

INSTRUCTIONS FOR SPECIFIC FIELD TYPES:
- Options: If options are listed, return option text exactly as written.
- Checkbox-group: Return comma-separated list of matching options.
- Yes/No: Return only "Yes" or "No".
- Eligibility/Authorization: For questions about work authorization or visa requirements, answer with "Yes" or "No" matching your profile settings. Do NOT use work authorization phrases unless they match the specific options listed.

QUESTIONS:
${questionsBlock}`;

    const result = await this.call(apiKey, prompt, true, schema);
    const parsed = JSON.parse(result);

    // Map sanitized IDs back to original IDs
    const finalAnswers = {};
    Object.keys(parsed).forEach(sId => {
      const originalId = idMapping[sId] || sId;
      finalAnswers[originalId] = parsed[sId];
    });
    return finalAnswers;
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
- Professional but personable tone
- 3-4 paragraphs
- Highlight relevant experience from the resume
- Show enthusiasm for the specific role and company
- Keep under 400 words
- Do NOT include placeholder brackets like [Company Name] - use the actual names provided
- Ensure the portfolio URL https://skalamera.me is included in the header or sign-off
- Start with "Dear Hiring Manager," and end with "Sincerely," followed by the applicant's name`;

    return await this.call(apiKey, prompt, false);
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Gemini;
}
