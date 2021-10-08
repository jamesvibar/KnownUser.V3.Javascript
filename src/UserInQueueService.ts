import {Utils, QueueUrlParams, QueueParameterHelper} from './QueueITHelpers'
import {ActionTypes, RequestValidationResult, QueueEventConfig, CancelEventConfig} from './Models'
import {UserInQueueStateCookieRepository} from './UserInQueueStateCookieRepository'
import {IHttpContextProvider} from './HttpContextProvider';

export class UserInQueueService {
    static readonly SDK_VERSION = "v3-javascript-" + "3.7.3";

    constructor(private httpContextProvider: IHttpContextProvider, private userInQueueStateRepository: UserInQueueStateCookieRepository) {
    }

    private getValidTokenResult(
        config: QueueEventConfig,
        queueParams: QueueUrlParams,
        secretKey: string)
        : RequestValidationResult {

        this.userInQueueStateRepository.store(
            config.eventId,
            queueParams.queueId,
            queueParams.cookieValidityMinutes,
            config.cookieDomain,
            config.isCookieHttpOnly,
            config.isCookieSecure,
            queueParams.redirectType,
            secretKey);

        return new RequestValidationResult(
            ActionTypes.QueueAction,
            config.eventId,
            queueParams.queueId,
            null,
            queueParams.redirectType,
            config.actionName,
        );
    }

    private getErrorResult(
        customerId: string,
        targetUrl: string,
        config: QueueEventConfig,
        qParams: QueueUrlParams,
        errorCode: string)
        : RequestValidationResult {

        const query = this.getQueryString(customerId, config.eventId, config.version, config.culture, config.layoutName, config.actionName) +
            `&queueittoken=${qParams.queueITToken}` +
            `&ts=${Utils.getCurrentTime()}` +
            (targetUrl ? `&t=${Utils.encodeUrl(targetUrl)}` : "");

        const uriPath = `error/${errorCode}/`;

        const redirectUrl = this.generateRedirectUrl(config.queueDomain, uriPath, query);

        return new RequestValidationResult(
            ActionTypes.QueueAction,
            config.eventId,
            null,
            redirectUrl,
            null,
            config.actionName
        );
    }

    private getQueueResult(
        targetUrl: string,
        config: QueueEventConfig,
        customerId: string)
        : RequestValidationResult {

        let query = this.getQueryString(customerId,
            config.eventId,
            config.version,
            config.culture,
            config.layoutName,
            config.actionName) +
            (targetUrl ? "&t=" + Utils.encodeUrl(targetUrl) : "");

        const redirectUrl = this.generateRedirectUrl(config.queueDomain, "", query);

        return new RequestValidationResult(
            ActionTypes.QueueAction,
            config.eventId,
            null,
            redirectUrl,
            null,
            config.actionName
        );
    }

    private getQueryString(
        customerId: string,
        eventId: string,
        configVersion: number,
        culture: string | null,
        layoutName: string | null,
        actionName: string | null)
        : string {
        const queryStringList = new Array<string>();
        queryStringList.push(`c=${Utils.encodeUrl(customerId)}`);
        queryStringList.push(`e=${Utils.encodeUrl(eventId)}`);
        queryStringList.push(`ver=${UserInQueueService.SDK_VERSION}`);
        queryStringList.push(`cver=${configVersion}`);
        queryStringList.push(`man=${Utils.encodeUrl(actionName)}`)

        if (culture)
            queryStringList.push("cid=" + Utils.encodeUrl(culture));

        if (layoutName)
            queryStringList.push("l=" + Utils.encodeUrl(layoutName));

        return queryStringList.join("&");
    }

    private generateRedirectUrl(queueDomain: string, uriPath: string, query: string) {
        if (!Utils.endsWith(queueDomain, "/"))
            queueDomain = queueDomain + "/";

        return `https://${queueDomain}${uriPath}?${query}`;
    }

    public validateQueueRequest(
        targetUrl: string,
        queueitToken: string,
        config: QueueEventConfig,
        customerId,
        secretKey) {
        const state = this.userInQueueStateRepository.getState(config.eventId,
            config.cookieValidityMinute, secretKey, true);

        if (state.isValid) {
            if (state.isStateExtendable() && config.extendCookieValidity) {
                this.userInQueueStateRepository.store(config.eventId,
                    state.queueId,
                    null,
                    config.cookieDomain,
                    config.isCookieHttpOnly,
                    config.isCookieSecure,
                    state.redirectType,
                    secretKey);
            }
            return new RequestValidationResult(
                ActionTypes.QueueAction,
                config.eventId,
                state.queueId,
                null,
                state.redirectType,
                config.actionName
            );
        }
        const queueParams = QueueParameterHelper.extractQueueParams(queueitToken);

        let requestValidationResult: RequestValidationResult;
        let isTokenValid = false;

        if (queueParams != null) {
            const tokenValidationResult = this.validateToken(config, queueParams, secretKey);
            isTokenValid = tokenValidationResult.isValid;

            if (isTokenValid) {
                requestValidationResult = this.getValidTokenResult(config, queueParams, secretKey);
            } else {
                requestValidationResult = this.getErrorResult(customerId, targetUrl, config, queueParams, tokenValidationResult.errorCode);
            }
        } else {
            requestValidationResult = this.getQueueResult(targetUrl, config, customerId);
        }

        if (state.isFound && !isTokenValid) {
            this.userInQueueStateRepository.cancelQueueCookie(
                config.eventId,
                config.cookieDomain,
                config.isCookieHttpOnly,
                config.isCookieSecure);
        }

        return requestValidationResult;

    }

    public validateCancelRequest(
        targetUrl: string,
        config: CancelEventConfig,
        customerId: string,
        secretKey: string): RequestValidationResult {
        //we do not care how long cookie is valid while canceling cookie
        const state = this.userInQueueStateRepository.getState(config.eventId, -1, secretKey, false);

        if (state.isValid) {
            this.userInQueueStateRepository.cancelQueueCookie(config.eventId,
                config.cookieDomain,
                config.isCookieHttpOnly,
                config.isCookieSecure);

            const query = this.getQueryString(customerId, config.eventId, config.version, null, null, config.actionName) +
                (targetUrl ? "&r=" + Utils.encodeUrl(targetUrl) : "");

            let uriPath = `cancel/${customerId}/${config.eventId}`;
            if (state.queueId) {
                uriPath += `/${state.queueId}`;
            }

            const redirectUrl = this.generateRedirectUrl(config.queueDomain, uriPath, query);

            return new RequestValidationResult(
                ActionTypes.CancelAction,
                config.eventId,
                state.queueId,
                redirectUrl,
                state.redirectType,
                config.actionName);
        } else {
            return new RequestValidationResult(
                ActionTypes.CancelAction,
                config.eventId,
                null,
                null,
                null,
                config.actionName);
        }
    }

    public extendQueueCookie(
        eventId: string,
        cookieValidityMinutes: number,
        cookieDomain: string,
        secretKey: string) {
        this.userInQueueStateRepository.reissueQueueCookie(eventId, cookieValidityMinutes, cookieDomain, secretKey)
    }

    public getIgnoreResult(
        actionName: string): RequestValidationResult {
        return new RequestValidationResult(ActionTypes.IgnoreAction, null, null, null, null, actionName);
    }

    private validateToken(
        config: QueueEventConfig,
        queueParams: QueueUrlParams,
        secretKey: string): TokenValidationResult {

        const calculatedHash = Utils.generateSHA256Hash(secretKey, queueParams.queueITTokenWithoutHash);

        if (calculatedHash !== queueParams.hashCode)
            return new TokenValidationResult(false, "hash");

        if (queueParams.eventId !== config.eventId)
            return new TokenValidationResult(false, "eventid");

        if (queueParams.timeStamp < Utils.getCurrentTime())
            return new TokenValidationResult(false, "timestamp");

        const clientIp = this.httpContextProvider.getHttpRequest().getUserHostAddress();
        if (queueParams.hashedIp && clientIp) {
            const hashedIp = Utils.generateSHA256Hash(secretKey, clientIp);
            if (hashedIp !== queueParams.hashedIp) {
                return new TokenValidationResult(false, "ip");
            }
        }

        return new TokenValidationResult(true, null);
    }

}

class TokenValidationResult {
    constructor(
        public isValid: boolean,
        public errorCode: string) {
    }
}
