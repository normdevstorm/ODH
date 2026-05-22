/**
 * VocabKitchen CEFR profiler client.
 * API: POST https://www.vocabkitchen.com/profiler
 * Body: { ProfilerType: "cefr", InputText: "<sentence or word>" }
 */
const VOCABKITCHEN_PROFILER_URL = 'https://www.vocabkitchen.com/profiler';
const VOCABKITCHEN_CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const VOCABKITCHEN_CACHE_PREFIX = 'vk_cefr:';
const VOCABKITCHEN_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

class VocabKitchenCefr {
    /**
     * Strips dictionary noise (IPA, extra spaces) from the headword.
     * e.g. "demand   /di'mænd/" → "demand"
     *
     * @param {string} raw
     * @returns {string|null}
     */
    sanitizeLemma(raw) {
        if (!raw) return null;

        let text = String(raw)
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // IPA in slashes: /di'mænd/, /ˈdemɑːnd/
        text = text.replace(/\s*\/[^/]+\/\s*/g, ' ').trim();
        // Parenthetical phonetics: (dɪˈmænd)
        text = text.replace(/\s*\([^)]*[/ˈˌɑæɪʌɔəɜ][^)]*\)\s*/gi, ' ').trim();
        // Trailing inline phonetic fragments after the headword
        text = text.replace(/\s+['ˈˌ][^\s]+$/g, '').trim();

        text = text.split(/[\r\n]/)[0].trim();
        text = text.replace(/\s+/g, ' ').trim();

        return text || null;
    }

    normalizeToken(token) {
        if (!token) return '';
        return token.toLowerCase().replace(/^[^a-z0-9'-]+|[^a-z0-9'-]+$/gi, '');
    }

    _matchesLemma(wordToken, lemma) {
        if (!wordToken || !lemma) return false;
        if (wordToken === lemma) return true;
        if (!wordToken.startsWith(lemma)) return false;

        const suffix = wordToken.slice(lemma.length);
        if (!suffix) return true;

        return /^(s|es|ed|d|ing|er|est|ly|ment|tion|ions?|ies|ied|y)?$/.test(suffix);
    }

    /**
     * Resolves CEFR level (A1–C2) for a lemma using VocabKitchen.
     * Returns null when unknown, off-list, or the request fails.
     *
     * @param {string} lemma - raw or sanitized headword
     * @param {string} [contextText] - sentence where the word appears
     * @returns {Promise<string|null>}
     */
    async lookupCefr(lemma, contextText) {
        const sanitized = this.sanitizeLemma(lemma);
        const normalizedLemma = this.normalizeToken(sanitized);
        if (!normalizedLemma) return null;

        const cached = await this._getCached(normalizedLemma);
        if (cached) return cached;

        const inputText = this._buildInputText(sanitized, normalizedLemma, contextText);
        const profile = await this._fetchProfile(inputText);
        if (!profile) return null;

        const level = this._extractLemmaLevel(profile, normalizedLemma);
        if (level) {
            await this._setCached(normalizedLemma, level);
        } else {
            console.debug(
                '[VocabKitchen] no CEFR match for lemma=%s input=%s',
                normalizedLemma,
                inputText.slice(0, 80),
            );
        }
        return level;
    }

    _buildInputText(sanitizedLemma, normalizedLemma, contextText) {
        const plain = (contextText || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (plain && plain.toLowerCase().includes(normalizedLemma)) {
            return plain;
        }
        return sanitizedLemma || normalizedLemma;
    }

    async _fetchProfile(inputText) {
        try {
            const response = await fetch(VOCABKITCHEN_PROFILER_URL, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ProfilerType: 'cefr',
                    InputText: inputText,
                }),
                signal: AbortSignal.timeout(8000),
            });

            if (!response.ok) {
                console.warn('[VocabKitchen] profiler HTTP', response.status);
                return null;
            }

            return await response.json();
        } catch (e) {
            console.warn('[VocabKitchen] profiler request failed:', e);
            return null;
        }
    }

    _extractLemmaLevel(profile, lemma) {
        const table = profile?.tableResult;
        if (!table) return null;

        for (const level of VOCABKITCHEN_CEFR_LEVELS) {
            const rows = table[level]?.rows || [];
            for (const row of rows) {
                const word = this._wordFromRowHtml(row.rowHtml);
                const token = word ? this.normalizeToken(word) : '';
                if (token && this._matchesLemma(token, lemma)) {
                    return level;
                }
            }
        }

        return null;
    }

    _wordFromRowHtml(rowHtml) {
        if (!rowHtml) return null;
        const match = rowHtml.match(/class=['"]word[^'"]*['"][^>]*>([^<]+)</);
        return match ? match[1].trim() : null;
    }

    async _getCached(lemma) {
        try {
            const key = VOCABKITCHEN_CACHE_PREFIX + lemma;
            const stored = await chrome.storage.local.get(key);
            const entry = stored[key];
            if (!entry || !entry.level || !entry.expiresAt) return null;
            if (Date.now() > entry.expiresAt) {
                await chrome.storage.local.remove(key);
                return null;
            }
            return entry.level;
        } catch (e) {
            return null;
        }
    }

    async _setCached(lemma, level) {
        try {
            const key = VOCABKITCHEN_CACHE_PREFIX + lemma;
            await chrome.storage.local.set({
                [key]: {
                    level,
                    expiresAt: Date.now() + VOCABKITCHEN_CACHE_TTL_MS,
                },
            });
        } catch (e) {
            // cache is best-effort
        }
    }
}
