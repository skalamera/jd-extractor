const Storage = {
  async get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  },

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },

  async remove(key) {
    await chrome.storage.local.remove(key);
  },

  // Profile
  async getProfile() {
    return (await this.get('profile')) || {};
  },

  async saveProfile(profile) {
    const existing = await this.getProfile();
    await this.set('profile', { ...existing, ...profile });
  },

  // Resume text (parsed)
  async getResumeText() {
    const active = await this.get('activeResumeText');
    if (active) return active;
    return await this.get('masterResumeText');
  },

  async saveResumeText(text) {
    await this.set('masterResumeText', text);
  },
  
  async getMasterResumeText() {
    return await this.get('masterResumeText');
  },
  
  async saveActiveResumeText(text) {
    await this.set('activeResumeText', text);
  },

  // Resume file (base64 PDF for re-attachment)
  async getResumeFile() {
    return await this.get('resumeFile');
  },

  async saveResumeFile(base64Data, fileName) {
    await this.set('resumeFile', { data: base64Data, fileName });
  },

  // Gemini API key
  async getApiKey() {
    return await this.get('geminiApiKey');
  },

  async saveApiKey(key) {
    await this.set('geminiApiKey', key);
  },

  // Settings
  async getSettings() {
    return (await this.get('settings')) || {
      coverLetterTone: 'professional',
      coverLetterLength: 'medium',
      autoFillDelay: 150
    };
  },

  async saveSettings(settings) {
    const existing = await this.getSettings();
    await this.set('settings', { ...existing, ...settings });
  },

  // Custom Q&A pairs
  async getCustomQA() {
    return (await this.get('customQA')) || [];
  },

  async saveCustomQA(qaList) {
    await this.set('customQA', qaList);
  },

  // Structured resume data (from Gemini analysis)
  async getStructuredResume() {
    return await this.get('structuredResume');
  },

  async saveStructuredResume(data) {
    await this.set('structuredResume', data);
  }
};
