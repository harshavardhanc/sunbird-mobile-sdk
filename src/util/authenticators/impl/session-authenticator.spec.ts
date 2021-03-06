import { SessionAuthenticator } from './session-authenticator';
import { SharedPreferences, ApiConfig, ApiService, AuthService, Request, HttpRequestType, Response, ResponseCode } from '../../..';
import { of } from 'rxjs';
import { AuthKeys } from '../../../preference-keys';

describe('SessionAuthenticator', () => {
    let sessionAuthenticator: SessionAuthenticator;
    const mockApiConfig: Partial<ApiConfig> = {};
    const mockApiService: Partial<ApiService> = {};
    const mockAuthService: Partial<AuthService> = {};
    const mockSharedPreferences: Partial<SharedPreferences> = {};

        beforeAll(() => {
            sessionAuthenticator = new SessionAuthenticator(
                mockSharedPreferences as SharedPreferences,
                mockApiConfig as ApiConfig,
                mockApiService as ApiService,
                mockAuthService as AuthService
            );
        });

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should create a instance of SessionAuthenticator', () => {
            expect(sessionAuthenticator).toBeTruthy();
        });

        it('should get auth data from local by invoked interceptRequest()', (done) => {
            // arrange
            const request = new Request.Builder()
            .withPath('/')
            .withType(HttpRequestType.POST)
            .withBody(new Uint8Array([]))
            .withHeaders({
                'content_type': 'application/text'
            })
            .build();
            const data = mockSharedPreferences.getString = jest.fn(() => of('application/text'));
            JSON.parse = jest.fn().mockImplementationOnce(() => {
                return data;
              });
            // act
            sessionAuthenticator.interceptRequest(request).subscribe(() => {
                // assert
                expect(mockSharedPreferences.getString).toHaveBeenCalledWith(AuthKeys.KEY_OAUTH_SESSION);
                done();
            });
        });

        it('should return response for responseCode is not available by invoked interceptResponse() ', (done) => {
            // arrange
            const res = new Response();
            const request = new Request.Builder()
            .withPath('/')
            .withType(HttpRequestType.POST)
            .withBody(new Uint8Array([]))
            .withHeaders({
                'content_type': 'application/text'
            })
            .build();
            // act
            sessionAuthenticator.interceptResponse(request, res).subscribe(() => {
                // assert
                expect(res.responseCode).not.toBe(ResponseCode.HTTP_UNAUTHORISED);
                done();
            });
        });

        it('should return response if message body is available by invoked interceptResponse() ', (done) => {
            // arrange
            const res = new Response();
            res.responseCode = ResponseCode.HTTP_UNAUTHORISED;
            res.body = {
                message: 'Unauthorized'
            };
            const request = new Request.Builder()
            .withPath('/')
            .withType(HttpRequestType.POST)
            .withBody(new Uint8Array([]))
            .withHeaders({
                'content_type': 'application/text'
            })
            .build();
            // act
            sessionAuthenticator.interceptResponse(request, res).subscribe(() => {
                // assert
                expect(res.responseCode).toBe(ResponseCode.HTTP_UNAUTHORISED);
                expect(res.body.message).not.toBeNull();
                done();
            });
        });

        it('should refresh auth tokenby invoked interceptResponse() ', (done) => {
            // arrange
            const res = new Response();
            res.responseCode = ResponseCode.HTTP_UNAUTHORISED;
            res.body = {};
            const request = new Request.Builder()
            .withPath('/')
            .withType(HttpRequestType.POST)
            .withBody(new Uint8Array([]))
            .withHeaders({
                'content_type': 'application/text'
            })
            .build();
            mockAuthService.refreshSession = jest.fn(() => of({}));
            mockApiService.fetch = jest.fn(() => of({}));
            // act
            sessionAuthenticator.interceptResponse(request, res).subscribe(() => {
                // assert
                expect(res.responseCode).toBe(ResponseCode.HTTP_UNAUTHORISED);
                expect(res.body.message).toBeUndefined();
                expect(mockAuthService.refreshSession).toHaveBeenCalled();
                expect(mockApiService.fetch).toHaveBeenCalled();
                done();
            });
        });
});
