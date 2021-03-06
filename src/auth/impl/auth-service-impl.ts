import {AuthService, OAuthSession, SessionProvider} from '..';
import {ApiConfig, ApiService} from '../../api';
import {AuthUtil} from '../util/auth-util';
import {Observable, from} from 'rxjs';
import {SharedPreferences} from '../../util/shared-preferences';
import {EventsBusService} from '../../events-bus';
import { inject, injectable } from 'inversify';
import { InjectionTokens } from '../../injection-tokens';
import { SdkConfig } from '../../sdk-config';

@injectable()
export class AuthServiceImpl implements AuthService {

    private authUtil: AuthUtil;
    private apiConfig: ApiConfig;

    constructor(
        @inject(InjectionTokens.SDK_CONFIG) private sdkConfig: SdkConfig,
        @inject(InjectionTokens.API_SERVICE) private apiService: ApiService,
        @inject(InjectionTokens.SHARED_PREFERENCES) private sharedPreferences: SharedPreferences,
        @inject(InjectionTokens.EVENTS_BUS_SERVICE) private eventsBusService: EventsBusService,
    ) {
        this.apiConfig = this.sdkConfig.apiConfig;
        this.authUtil = new AuthUtil(this.apiConfig, this.apiService, this.sharedPreferences, this.eventsBusService);
    }

    setSession(sessionProvider: SessionProvider): Observable<undefined> {
        return from(sessionProvider.provide().then((sessionData) => {
            this.authUtil.startSession(sessionData);
            return undefined;
        }));
    }

    getSession(): Observable<OAuthSession | undefined> {
        return from(this.authUtil.getSessionData());
    }

    resignSession(): Observable<void> {
        return from(this.authUtil.endSession());
    }

    refreshSession(): Observable<void> {
        return from(this.authUtil.refreshSession());
    }
}
