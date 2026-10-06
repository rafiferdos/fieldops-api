import { Inject, Injectable } from '@nestjs/common';
import { hashPassword } from '../../common/security/password.js';
import { UsersService } from '../users/users.service.js';
import type { RegisterInput } from './schemas/register.schema.js';

@Injectable()
export class AuthService {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  async register(input: RegisterInput) {
    const passwordHash = await hashPassword(input.password);
    return this.users.createCustomer({
      name: input.name,
      email: input.email,
      passwordHash,
    });
  }
}
