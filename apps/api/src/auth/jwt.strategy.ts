import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: { query?: { token?: string } }) => (typeof req?.query?.token === 'string' ? req.query.token : null),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET') || 'm5azen-dev-secret',
    });
  }

  validate(payload: { sub: string; username: string; role: Role }) {
    return { userId: payload.sub, username: payload.username, role: payload.role };
  }
}
