export declare function validateEnv(input: Record<string, unknown>): {
    NODE_ENV: "development" | "test" | "production";
    PORT: number;
    FRONTEND_ORIGIN: string;
    DATABASE_URL: string;
};
