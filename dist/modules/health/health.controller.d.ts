import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
export declare class HealthController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    live(): {
        success: boolean;
        message: string;
        data: {
            status: string;
        };
    };
    ready(): Promise<{
        success: boolean;
        message: string;
        data: {
            database: string;
        };
    }>;
}
