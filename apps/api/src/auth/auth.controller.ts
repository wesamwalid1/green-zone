import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { Public } from '../common/guards';
import { assertLoginRate } from '../common/login-rate-limit';

class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(4)
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: { ip?: string; socket?: { remoteAddress?: string } }) {
    assertLoginRate(req.ip || req.socket?.remoteAddress || 'local');
    return this.auth.login(dto.username, dto.password);
  }

  @Get('me')
  me(@Req() req: { user: { userId: string } }) {
    return this.auth.me(req.user.userId);
  }
}
