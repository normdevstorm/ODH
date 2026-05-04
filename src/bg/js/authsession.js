class ServerConnectAuthSession {
    constructor() {
        this.baseUrl = 'http://localhost:8085';
        this.accessToken = null;
        this.refreshToken = null;
        this.expiresAt = null;
        this.refreshPromise = null;
    }

    configure(options = {}) {
        this.baseUrl = options.serverconnecturl || this.baseUrl;

        if (Object.prototype.hasOwnProperty.call(options, 'serverconnecttoken')) {
            this.accessToken = options.serverconnecttoken || null;
        }

        if (Object.prototype.hasOwnProperty.call(options, 'serverconnectrefreshtoken')) {
            this.refreshToken = options.serverconnectrefreshtoken || null;
        }

        if (Object.prototype.hasOwnProperty.call(options, 'serverconnecttokenexpiresat')) {
            this.expiresAt = this._normalizeExpiresAt(options.serverconnecttokenexpiresat);
        }
    }

    setSession({ accessToken = null, refreshToken = null, expiresAt = null } = {}) {
        if (accessToken !== null) {
            this.accessToken = accessToken || null;
        }

        if (refreshToken !== null) {
            this.refreshToken = refreshToken || null;
        }

        if (expiresAt !== null) {
            this.expiresAt = this._normalizeExpiresAt(expiresAt);
        }
    }

    clearSession() {
        this.accessToken = null;
        this.refreshToken = null;
        this.expiresAt = null;
    }

    isAccessTokenAvailable() {
        return !!this.accessToken;
    }

    isAccessTokenExpired(bufferSeconds = 30) {
        if (!this.expiresAt) {
            return false;
        }

        const expiresAtMs = this._normalizeExpiresAt(this.expiresAt);
        if (!expiresAtMs) {
            return false;
        }

        return Date.now() >= (expiresAtMs - (bufferSeconds * 1000));
    }

    async getAuthorizationHeader(forceRefresh = false, refreshHandler = null) {
        if (forceRefresh) {
            await this.refreshAccessToken(refreshHandler);
        } else if (!this.isAccessTokenAvailable() || this.isAccessTokenExpired()) {
            await this.refreshAccessToken(refreshHandler);
        }

        return this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {};
    }

    async refreshAccessToken(refreshHandler = null) {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        if (!this.refreshToken || typeof refreshHandler !== 'function') {
            return null;
        }

        this.refreshPromise = (async () => {
            const response = await refreshHandler(this);
            if (!response) {
                return null;
            }

            this.applyTokenResponse(response);
            return response;
        })();

        try {
            return await this.refreshPromise;
        } finally {
            this.refreshPromise = null;
        }
    }

    applyTokenResponse(response = {}) {
        const tokenSource = response && typeof response === 'object' && response.data && typeof response.data === 'object'
            ? response.data
            : response;

        const accessToken = tokenSource.accessToken || tokenSource.token || tokenSource.jwt || tokenSource.access_token || null;
        const refreshToken = tokenSource.refreshToken || tokenSource.refresh_token || null;
        const expiresAt = tokenSource.expiresAt || tokenSource.expires_at || null;
        const expiresIn = tokenSource.expiresIn || tokenSource.expires_in || null;

        if (accessToken) {
            this.accessToken = accessToken;
        }

        if (refreshToken) {
            this.refreshToken = refreshToken;
        }

        if (expiresAt) {
            this.expiresAt = this._normalizeExpiresAt(expiresAt);
        } else if (expiresIn) {
            const expiresInMs = Number(expiresIn) * 1000;
            this.expiresAt = Number.isFinite(expiresInMs) ? Date.now() + expiresInMs : null;
        }
    }

    toStoragePatch() {
        return {
            serverconnecttoken: this.accessToken || '',
            serverconnectrefreshtoken: this.refreshToken || '',
            serverconnecttokenexpiresat: this.expiresAt || '',
        };
    }

    _normalizeExpiresAt(value) {
        if (!value) {
            return null;
        }

        if (value instanceof Date) {
            return value.getTime();
        }

        if (typeof value === 'number') {
            return value < 1e12 ? value * 1000 : value;
        }

        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) {
            return asNumber < 1e12 ? asNumber * 1000 : asNumber;
        }

        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
}