declare module 'passport-custom' {
  import { Request } from 'express';
  import { Strategy as PassportStrategy } from 'passport';

  export type VerifyCallback = (
    error: unknown,
    user?: unknown,
    info?: unknown,
  ) => void;
  export type VerifyFunction = (req: Request, callback: VerifyCallback) => void;

  export class Strategy extends PassportStrategy {
    constructor(verify: VerifyFunction);
    name: string;
  }
}
