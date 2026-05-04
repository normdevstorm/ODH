/* global ServerConnectAuthSession */
class ServerConnect {
    constructor() {
        this.version = '1';
        this.url = 'http://localhost:8085'; // default server url
        this.token = null;
        this.refreshToken = null;
        this.tokenExpiresAt = null;
        this.connected = false;
        this.authSession = new ServerConnectAuthSession();
    }

    async initConnection(options) {
        this.setOptions(options);
        this.connected = await this.checkConnection();
    }

    setOptions(options = {}) {
        this.url = options.serverconnecturl || this.url;
        this.token = options.serverconnecttoken || null;
        this.refreshToken = options.serverconnectrefreshtoken || null;
        this.tokenExpiresAt = options.serverconnecttokenexpiresat || null;

        this.authSession.configure(options);
        this.authSession.setSession({
            accessToken: this.token,
            refreshToken: this.refreshToken,
            expiresAt: this.tokenExpiresAt,
        });
    }

    async checkConnection() {
        try {
            const response = await fetch(`${this.url}/v1/extension-digests/save`, {
                method: 'OPTIONS',
                signal: AbortSignal.timeout(3000)
            });
            // Any response (even 4xx) means server is reachable
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * POST /v1/extension-digests/save
     * @param {object} wordData - ExtensionWordCreateRequest fields
     * @param {string}  wordData.lemma
     * @param {string}  wordData.type             - e.g. "noun", "verb"
     * @param {string}  [wordData.ipa]
     * @param {string}  [wordData.audioUrl]
     * @param {string}  [wordData.destLang]        - target language code, e.g. "vi"
     * @param {string}  [wordData.destLangMeaning]
     * @param {string}  [wordData.exampleSentence]
     * @param {string}  [wordData.exampleTranslation]
     * @param {string}  [wordData.contextSentence]
     * @param {string}  [wordData.contextTranslation]
     * @param {string}  [wordData.contextUrl]
     * @param {string}  [wordData.difficultyLevel]
     * @param {number}  [wordData.frequencyScore]
     * @returns {Promise<object|null>} BaseResponseVoid { success, data, message } or null on error
     */
    async saveWord(wordData) {
        if (!wordData || !wordData.lemma) return null;

        try {
            const rawResponse = await this._requestJson('/v1/extension-digests/save', {
                method: 'POST',
                body: JSON.stringify(wordData)
            });

            let response = null;
            try {
                response = await rawResponse.json();
            } catch (e) {
                response = null;
            }

            if (!rawResponse.ok) {
                console.warn('[ServerConnect] saveWord failed:', response?.message);
                if (rawResponse.status === 401) {
                    this.authSession.clearSession();
                    await this._persistAuthSession();
                }
                return null;
            }

            return response; // { success, data, message }
        } catch (e) {
            console.error('[ServerConnect] saveWord error:', e);
            return null;
        }
    }

    async _persistAuthSession() {
        const patch = this.authSession.toStoragePatch();

        try {
            await chrome.storage.local.set(patch);
        } catch (e) {
            console.warn('[ServerConnect] failed to persist auth session:', e);
        }
    }

    async _refreshAuthSession() {
        const refreshUrl = `${this.url}/refresh-token`;

        try {
            const response = await fetch(refreshUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json; charset=utf-8'
                },
                body: JSON.stringify({
                    refresh_token: this.authSession.refreshToken,
                }),
                signal: AbortSignal.timeout(6000)
            });

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            if (!data) {
                return null;
            }

            this.authSession.applyTokenResponse(data);
            this.token = this.authSession.accessToken;
            this.refreshToken = this.authSession.refreshToken;
            this.tokenExpiresAt = this.authSession.expiresAt;
            await this._persistAuthSession();
            return data;
        } catch (e) {
            console.warn('[ServerConnect] refresh token request failed:', e);
            return null;
        }
    }

    async _requestJson(path, options = {}, retryOnUnauthorized = true) {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json; charset=utf-8',
            ...(options.headers || {})
        };

        const authHeaders = await this.authSession.getAuthorizationHeader(false, () => this._refreshAuthSession());
        Object.assign(headers, authHeaders);

        const response = await fetch(`${this.url}${path}`, {
            ...options,
            headers,
        });

        if (response.status === 401 && retryOnUnauthorized) {
            const refreshed = await this.authSession.refreshAccessToken(() => this._refreshAuthSession());
            if (refreshed) {
                return this._requestJson(path, options, false);
            }
        }

        return response;
    }
                                                                                                               
    /**
     * Fetches the Vietnamese (or any destLang) translation of a plain-text sentence
     * using the MyMemory free translation API.
     * URL: https://api.mymemory.translated.net/get?q={text}&langpair=en|{destLang}
     * Response: { responseStatus: 200, responseData: { translatedText: "..." } }
     *
     * Glosbe is NOT used here because its sentence pages return 404 —
     * it is a word dictionary, not a sentence translator.
     *
     * @param {string} sentence   - raw sentence, may contain HTML tags
     * @param {string} destLang   - target language code, e.g. "vi"
     * @returns {Promise<string|null>}
     */
    async _fetchContextTranslation(sentence, destLang = 'vi') {
        if (!sentence) return null;

        // Strip any HTML tags (e.g. <b>word</b>) before sending to the API
        const plain = sentence.replace(/<[^>]+>/g, '').trim();
        if (!plain) return null;

        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(plain)}&langpair=en|${destLang}`;

        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(6000)
            });
            if (!response.ok) return null;

            const data = await response.json();

            if (data?.responseStatus === 200 && data?.responseData?.translatedText) {
                return data.responseData.translatedText;
            }
            return null;
        } catch (e) {
            console.warn('[ServerConnect] _fetchContextTranslation error:', e);
            return null;
        }
    }

    /**
     * Parses the definition HTML from a dictionary script to extract:
     *   - meaning:             text inside <span class='vi_tran'>
     *   - exampleSentence:    text inside <span class='en_sent'>  (first match)
     *   - exampleTranslation: text inside <span class='vi_sent'>  (first match)
     *
     * Uses regex because this runs inside a service worker (no DOM / DOMParser available).
     *
     * @param {string} html
     * @returns {{ meaning: string|null, exampleSentence: string|null, exampleTranslation: string|null }}
     */
    _parseDefinitionHtml(html) {
        if (!html) return { meaning: null, exampleSentence: null, exampleTranslation: null };

        const meaningMatch    = html.match(/<span[^>]*class=['"]vi_tran['"][^>]*>([\s\S]*?)<\/span>/);
        const enSentMatch     = html.match(/<span[^>]*class=['"]en_sent['"][^>]*>([\s\S]*?)<\/span>/);
        const viSentMatch     = html.match(/<span[^>]*class=['"]vi_sent['"][^>]*>([\s\S]*?)<\/span>/);

        // Strip any residual HTML tags that may be nested inside the matched text
        const strip = s => s ? s.replace(/<[^>]+>/g, '').trim() : null;

        return {
            meaning:             strip(meaningMatch?.[1]),
            exampleSentence:     strip(enSentMatch?.[1]),
            exampleTranslation:  strip(viSentMatch?.[1]),
        };
    }

    /**
     * Adapter: maps the internal ODH notedef structure to ExtensionWordCreateRequest
     * and calls saveWord. Allows ServerConnect to be used as a drop-in target alongside Anki.
     *
     * notedef fields (from sandbox dict scripts):
     *   expression, reading, extrainfo, definition, definitions, sentence, url, audios[]
     *
     * Field mapping:
     *   destLangMeaning    ← vi_tran parsed from definition HTML
     *   exampleSentence    ← en_sent parsed from definition HTML  (dictionary example)
     *   exampleTranslation ← vi_sent parsed from definition HTML
     *   contextSentence    ← notedef.sentence  (the sentence on the page where word was found)
     *   contextUrl         ← notedef.url
     *
     * @param {object} notedef
     * @returns {Promise<object|null>}
     */
    async addNote(notedef) {
        if (!notedef) return null;

        const definitionHtml = notedef.definition ||
                               (notedef.definitions ? notedef.definitions[0] : '') || '';
        const parsed = this._parseDefinitionHtml(definitionHtml);

        // Strip HTML tags from the raw page sentence (e.g. <b>word</b> → word)
        const strip = s => s ? s.replace(/<[^>]+>/g, '').trim() : null;
        const plainSentence = strip(notedef.sentence);

        // Fetch Vietnamese translation of the context sentence in parallel with everything else
        const contextTranslation = await this._fetchContextTranslation(plainSentence, 'vi');

        const wordData = {
            lemma:               notedef.expression || null,
            type:                notedef.extrainfo  || null,
            ipa:                 notedef.reading    || null,
            audioUrl:            (notedef.audios && notedef.audios.length > 0) ? notedef.audios[0] : null,
            destLang:            'vi',
            destLangMeaning:     parsed.meaning            || null,
            exampleSentence:     parsed.exampleSentence    || null,
            exampleTranslation:  parsed.exampleTranslation || null,
            contextSentence:     plainSentence             || null,
            contextTranslation:  contextTranslation        || null,
            contextUrl:          notedef.url               || null,
        };

        return await this.saveWord(wordData);
    }

    async getVersion() {
        return this.connected ? this.version : null;
    }

    async login(credentials = {}) {
        const loginUrl = `${this.url}/login`;

        try {
            const response = await fetch(loginUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json; charset=utf-8'
                },
                body: JSON.stringify({
                    ...credentials,
                    platform: 'extension'
                }),
                signal: AbortSignal.timeout(6000)
            });

            if (!response.ok) {
                console.warn('[ServerConnect] login failed:', response.status);
                return null;
            }

            const data = await response.json();
            if (!data) {
                return null;
            }

            this.authSession.applyTokenResponse(data);
            this.token = this.authSession.accessToken;
            this.refreshToken = this.authSession.refreshToken;
            this.tokenExpiresAt = this.authSession.expiresAt;
            await this._persistAuthSession();
            return data;
        } catch (e) {
            console.warn('[ServerConnect] login request failed:', e);
            return null;
        }
    }

    async logout() {
        this.authSession.clearSession();
        this.token = null;
        this.refreshToken = null;
        this.tokenExpiresAt = null;
        await this._persistAuthSession();
    }

    getAuthStatus() {
        return {
            isLoggedIn: this.authSession.isAccessTokenAvailable(),
            isExpired: this.authSession.isAccessTokenExpired(),
            accessToken: this.authSession.accessToken || null,
            refreshToken: this.authSession.refreshToken || null,
            expiresAt: this.authSession.expiresAt || null
        };
    }
}
