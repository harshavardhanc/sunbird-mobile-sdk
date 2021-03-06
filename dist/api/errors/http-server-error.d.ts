import { SunbirdError } from '../../sunbird-error';
import { Response } from '..';
export declare class HttpServerError extends SunbirdError {
    readonly response: Response;
    constructor(message: string, response: Response);
}
