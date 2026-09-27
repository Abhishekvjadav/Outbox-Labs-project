import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { prisma } from '../prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
    },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const cookieToken = req.cookies?.reachflow_token;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : cookieToken;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as AuthUser;
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
      });

      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
        };
        return next();
      }
    } catch (err) {
      // Invalid token, fall through
    }
  }

  // If in development or demo mode and no valid token, check if default demo user exists
  if (config.demoMode) {
    let demoUser = await prisma.user.findFirst();
    if (!demoUser) {
      demoUser = await prisma.user.create({
        data: {
          email: 'abhishek@reachinbox.ai',
          name: 'Abhishek (Candidate Demo)',
          avatar: 'https://lh3.googleusercontent.com/a/default-user',
        },
      });
    }

    req.user = {
      id: demoUser.id,
      email: demoUser.email,
      name: demoUser.name,
      avatar: demoUser.avatar,
    };
    return next();
  }

  res.status(401).json({ error: 'Unauthorized. Please log in with Google.' });
}
