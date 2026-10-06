export declare const Role: {
    readonly CUSTOMER: "CUSTOMER";
    readonly TECHNICIAN: "TECHNICIAN";
    readonly ADMIN: "ADMIN";
};
export type Role = (typeof Role)[keyof typeof Role];
export declare const UserStatus: {
    readonly ACTIVE: "ACTIVE";
    readonly SUSPENDED: "SUSPENDED";
};
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
