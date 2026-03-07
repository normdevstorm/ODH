class ServerConnect {
    constructor() {
        this.version = '1';
        this.url = 'http://localhost:8085'; // default server url
        this.token = null;
        this.connected = false;
    }

    async initConnection(options) {
        this.url = options.serverconnecturl || this.url;
        this.token = options.serverconnecttoken || null;
        this.connected = await this.checkConnection();
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

        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json; charset=utf-8'
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const rawResponse = await fetch(`${this.url}/v1/extension-digests/save`, {
                method: 'POST',
                headers,
                body: JSON.stringify(wordData)
            });

            const response = await rawResponse.json();

            if (!rawResponse.ok) {
                console.warn('[ServerConnect] saveWord failed:', response?.message);
                return null;
            }

            return response; // { success, data, message }
        } catch (e) {
            console.error('[ServerConnect] saveWord error:', e);
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

        const wordData = {
            lemma:               notedef.expression || null,
            type:                notedef.extrainfo  || null,
            ipa:                 notedef.reading    || null,
            audioUrl:            (notedef.audios && notedef.audios.length > 0) ? notedef.audios[0] : null,
            destLang:            'vi',
            destLangMeaning:     parsed.meaning            || null,
            exampleSentence:     parsed.exampleSentence    || null,
            exampleTranslation:  parsed.exampleTranslation || null,
            contextSentence:     notedef.sentence          || null,
            contextUrl:          notedef.url               || null,
        };

        return await this.saveWord(wordData);
    }

    async getVersion() {
        return this.connected ? this.version : null;
    }
}
