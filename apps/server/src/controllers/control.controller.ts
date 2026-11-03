import type { Request, Response } from 'express';
import {
  ControlSessionExchangeRequestSchema,
  RotateNativeCredentialRequestSchema,
  RotateCompatCredentialRequestSchema,
  type ControlSessionExchangeResponse,
  type ControlSessionLogoutResponse,
} from '@paysim/contracts';
import type { ApplicationContext } from '../application/index.js';

export function createControlController(appContext: ApplicationContext) {
  return {
    sessionExchange: async (req: Request, res: Response): Promise<void> => {
      const validatedBody = ControlSessionExchangeRequestSchema.parse(req.body);
      const session = appContext.control.sessionExchange(validatedBody.token);

      // Scoped HttpOnly SameSite=Strict cookie for browser clients
      res.cookie('ps_control_session', session.sessionToken, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/control/v1',
      });

      // Also set header for non-browser HTTP clients
      res.setHeader('X-Control-Session', session.sessionToken);

      const responseBody: ControlSessionExchangeResponse = {
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      };

      res.status(200).json(responseBody);
    },

    sessionLogout: async (_req: Request, res: Response): Promise<void> => {
      const sessionToken = res.locals.controlSessionToken as string;
      if (sessionToken) {
        appContext.control.sessionLogout(sessionToken);
      }

      res.clearCookie('ps_control_session', { path: '/control/v1' });

      const responseBody: ControlSessionLogoutResponse = {
        success: true,
        message: 'Control session logged out successfully',
      };

      res.status(200).json(responseBody);
    },

    rotateNativeCredential: async (req: Request, res: Response): Promise<void> => {
      let validatedBody;
      if (req.body && Object.keys(req.body).length > 0) {
        validatedBody = RotateNativeCredentialRequestSchema.parse(req.body);
      }

      const credentialResponse = await appContext.control.rotateNativeCredential({
        request: validatedBody,
      });

      res.status(200).json(credentialResponse);
    },

    rotateCompatCredential: async (req: Request, res: Response): Promise<void> => {
      let validatedBody;
      if (req.body && Object.keys(req.body).length > 0) {
        validatedBody = RotateCompatCredentialRequestSchema.parse(req.body);
      }

      const credentialResponse = await appContext.control.rotateCompatCredential({
        request: validatedBody,
      });

      res.status(200).json(credentialResponse);
    },

    getCredentialsOverview: async (_req: Request, res: Response): Promise<void> => {
      const overview = appContext.control.getCredentialsOverview();
      res.status(200).json(overview);
    },
  };
}
