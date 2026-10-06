import * as runtime from "@prisma/client/runtime/client";
const config = {
    "previewFeatures": [],
    "clientVersion": "7.10.0",
    "engineVersion": "0edf323efd1d98336f3f0a68684b56f689b900d3",
    "activeProvider": "postgresql",
    "inlineSchema": "generator client {\n  provider     = \"prisma-client\"\n  output       = \"../src/generated/prisma\"\n  moduleFormat = \"esm\"\n}\n\ndatasource db {\n  provider = \"postgresql\"\n}\n\nenum Role {\n  CUSTOMER\n  TECHNICIAN\n  ADMIN\n}\n\nenum UserStatus {\n  ACTIVE\n  SUSPENDED\n}\n\nmodel User {\n  id           String     @id @default(uuid()) @db.Uuid\n  email        String     @unique\n  name         String\n  phone        String?\n  passwordHash String?\n  role         Role       @default(CUSTOMER)\n  status       UserStatus @default(ACTIVE)\n  deletedAt    DateTime?  @db.Timestamptz(3)\n  createdAt    DateTime   @default(now()) @db.Timestamptz(3)\n  updatedAt    DateTime   @updatedAt @db.Timestamptz(3)\n\n  @@index([role, status])\n}\n",
    "runtimeDataModel": {
        "models": {},
        "enums": {},
        "types": {}
    },
    "parameterizationSchema": {
        "strings": [],
        "graph": ""
    }
};
config.runtimeDataModel = JSON.parse("{\"models\":{\"User\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"email\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"phone\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"passwordHash\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"role\",\"kind\":\"enum\",\"type\":\"Role\"},{\"name\":\"status\",\"kind\":\"enum\",\"type\":\"UserStatus\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null,\"schema\":null}},\"enums\":{},\"types\":{}}");
config.parameterizationSchema = {
    strings: JSON.parse("[\"where\",\"User.findUnique\",\"User.findUniqueOrThrow\",\"orderBy\",\"cursor\",\"User.findFirst\",\"User.findFirstOrThrow\",\"User.findMany\",\"data\",\"User.createOne\",\"User.createMany\",\"User.createManyAndReturn\",\"User.updateOne\",\"User.updateMany\",\"User.updateManyAndReturn\",\"create\",\"update\",\"User.upsertOne\",\"User.deleteOne\",\"User.deleteMany\",\"having\",\"_count\",\"_min\",\"_max\",\"User.groupBy\",\"User.aggregate\",\"AND\",\"OR\",\"NOT\",\"id\",\"email\",\"name\",\"phone\",\"passwordHash\",\"Role\",\"role\",\"UserStatus\",\"status\",\"deletedAt\",\"createdAt\",\"updatedAt\",\"equals\",\"in\",\"notIn\",\"lt\",\"lte\",\"gt\",\"gte\",\"not\",\"contains\",\"startsWith\",\"endsWith\",\"set\"]"),
    graph: "QwkQDRoAADEAMBsAAAQAEBwAADEAMB0BAAAAAR4BAAAAAR8BADMAISABADQAISEBADQAISMAADUjIiUAADYlIiZAADcAISdAADgAIShAADgAIQEAAAABACABAAAAAQAgDRoAADEAMBsAAAQAEBwAADEAMB0BADIAIR4BADMAIR8BADMAISABADQAISEBADQAISMAADUjIiUAADYlIiZAADcAISdAADgAIShAADgAIQMgAAA6ACAhAAA6ACAmAAA6ACADAAAABAAgAwAABQAwBAAAAQAgAwAAAAQAIAMAAAUAMAQAAAEAIAMAAAAEACADAAAFADAEAAABACAKHQEAAAABHgEAAAABHwEAAAABIAEAAAABIQEAAAABIwAAACMCJQAAACUCJkAAAAABJ0AAAAABKEAAAAABAQgAAAkAIAodAQAAAAEeAQAAAAEfAQAAAAEgAQAAAAEhAQAAAAEjAAAAIwIlAAAAJQImQAAAAAEnQAAAAAEoQAAAAAEBCAAACwAwAQgAAAsAMAodAQA-ACEeAQA-ACEfAQA-ACEgAQA_ACEhAQA_ACEjAABAIyIlAABBJSImQABCACEnQABDACEoQABDACECAAAAAQAgCAAADgAgCh0BAD4AIR4BAD4AIR8BAD4AISABAD8AISEBAD8AISMAAEAjIiUAAEElIiZAAEIAISdAAEMAIShAAEMAIQIAAAAEACAIAAAQACACAAAABAAgCAAAEAAgAwAAAAEAIA8AAAkAIBAAAA4AIAEAAAABACABAAAABAAgBhUAADsAIBYAAD0AIBcAADwAICAAADoAICEAADoAICYAADoAIA0aAAAaADAbAAAXABAcAAAaADAdAQAbACEeAQAcACEfAQAcACEgAQAdACEhAQAdACEjAAAeIyIlAAAfJSImQAAgACEnQAAhACEoQAAhACEDAAAABAAgAwAAFgAwFAAAFwAgAwAAAAQAIAMAAAUAMAQAAAEAIA0aAAAaADAbAAAXABAcAAAaADAdAQAbACEeAQAcACEfAQAcACEgAQAdACEhAQAdACEjAAAeIyIlAAAfJSImQAAgACEnQAAhACEoQAAhACELFQAAIwAgFgAALwAgFwAALwAgKQEAAAABKgEAAAAEKwEAAAAELAEAAAABLQEAAAABLgEAAAABLwEAAAABMAEAMAAhDhUAACMAIBYAAC8AIBcAAC8AICkBAAAAASoBAAAABCsBAAAABCwBAAAAAS0BAAAAAS4BAAAAAS8BAAAAATABAC4AITEBAAAAATIBAAAAATMBAAAAAQ4VAAAmACAWAAAtACAXAAAtACApAQAAAAEqAQAAAAUrAQAAAAUsAQAAAAEtAQAAAAEuAQAAAAEvAQAAAAEwAQAsACExAQAAAAEyAQAAAAEzAQAAAAEHFQAAIwAgFgAAKwAgFwAAKwAgKQAAACMCKgAAACMIKwAAACMIMAAAKiMiBxUAACMAIBYAACkAIBcAACkAICkAAAAlAioAAAAlCCsAAAAlCDAAACglIgsVAAAmACAWAAAnACAXAAAnACApQAAAAAEqQAAAAAUrQAAAAAUsQAAAAAEtQAAAAAEuQAAAAAEvQAAAAAEwQAAlACELFQAAIwAgFgAAJAAgFwAAJAAgKUAAAAABKkAAAAAEK0AAAAAELEAAAAABLUAAAAABLkAAAAABL0AAAAABMEAAIgAhCxUAACMAIBYAACQAIBcAACQAIClAAAAAASpAAAAABCtAAAAABCxAAAAAAS1AAAAAAS5AAAAAAS9AAAAAATBAACIAIQgpAgAAAAEqAgAAAAQrAgAAAAQsAgAAAAEtAgAAAAEuAgAAAAEvAgAAAAEwAgAjACEIKUAAAAABKkAAAAAEK0AAAAAELEAAAAABLUAAAAABLkAAAAABL0AAAAABMEAAJAAhCxUAACYAIBYAACcAIBcAACcAIClAAAAAASpAAAAABStAAAAABSxAAAAAAS1AAAAAAS5AAAAAAS9AAAAAATBAACUAIQgpAgAAAAEqAgAAAAUrAgAAAAUsAgAAAAEtAgAAAAEuAgAAAAEvAgAAAAEwAgAmACEIKUAAAAABKkAAAAAFK0AAAAAFLEAAAAABLUAAAAABLkAAAAABL0AAAAABMEAAJwAhBxUAACMAIBYAACkAIBcAACkAICkAAAAlAioAAAAlCCsAAAAlCDAAACglIgQpAAAAJQIqAAAAJQgrAAAAJQgwAAApJSIHFQAAIwAgFgAAKwAgFwAAKwAgKQAAACMCKgAAACMIKwAAACMIMAAAKiMiBCkAAAAjAioAAAAjCCsAAAAjCDAAACsjIg4VAAAmACAWAAAtACAXAAAtACApAQAAAAEqAQAAAAUrAQAAAAUsAQAAAAEtAQAAAAEuAQAAAAEvAQAAAAEwAQAsACExAQAAAAEyAQAAAAEzAQAAAAELKQEAAAABKgEAAAAFKwEAAAAFLAEAAAABLQEAAAABLgEAAAABLwEAAAABMAEALQAhMQEAAAABMgEAAAABMwEAAAABDhUAACMAIBYAAC8AIBcAAC8AICkBAAAAASoBAAAABCsBAAAABCwBAAAAAS0BAAAAAS4BAAAAAS8BAAAAATABAC4AITEBAAAAATIBAAAAATMBAAAAAQspAQAAAAEqAQAAAAQrAQAAAAQsAQAAAAEtAQAAAAEuAQAAAAEvAQAAAAEwAQAvACExAQAAAAEyAQAAAAEzAQAAAAELFQAAIwAgFgAALwAgFwAALwAgKQEAAAABKgEAAAAEKwEAAAAELAEAAAABLQEAAAABLgEAAAABLwEAAAABMAEAMAAhDRoAADEAMBsAAAQAEBwAADEAMB0BADIAIR4BADMAIR8BADMAISABADQAISEBADQAISMAADUjIiUAADYlIiZAADcAISdAADgAIShAADgAIQgpAQAAAAEqAQAAAAQrAQAAAAQsAQAAAAEtAQAAAAEuAQAAAAEvAQAAAAEwAQA5ACELKQEAAAABKgEAAAAEKwEAAAAELAEAAAABLQEAAAABLgEAAAABLwEAAAABMAEALwAhMQEAAAABMgEAAAABMwEAAAABCykBAAAAASoBAAAABSsBAAAABSwBAAAAAS0BAAAAAS4BAAAAAS8BAAAAATABAC0AITEBAAAAATIBAAAAATMBAAAAAQQpAAAAIwIqAAAAIwgrAAAAIwgwAAArIyIEKQAAACUCKgAAACUIKwAAACUIMAAAKSUiCClAAAAAASpAAAAABStAAAAABSxAAAAAAS1AAAAAAS5AAAAAAS9AAAAAATBAACcAIQgpQAAAAAEqQAAAAAQrQAAAAAQsQAAAAAEtQAAAAAEuQAAAAAEvQAAAAAEwQAAkACEIKQEAAAABKgEAAAAEKwEAAAAELAEAAAABLQEAAAABLgEAAAABLwEAAAABMAEAOQAhAAAAAAE0AQAAAAEBNAEAAAABATQAAAAjAgE0AAAAJQIBNEAAAAABATRAAAAAAQAAAAADFQAGFgAHFwAIAAAAAxUABhYABxcACAECAQIDAQUGAQYHAQcIAQkKAQoMAgsNAwwPAQ0RAg4SBBETARIUARMVAhgYBRkZCQ"
};
async function decodeBase64AsWasm(wasmBase64) {
    const { Buffer } = await import('node:buffer');
    const wasmArray = Buffer.from(wasmBase64, 'base64');
    return new WebAssembly.Module(wasmArray);
}
config.compilerWasm = {
    getRuntime: async () => await import("@prisma/client/runtime/query_compiler_fast_bg.postgresql.mjs"),
    getQueryCompilerWasmModule: async () => {
        const { wasm } = await import("@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.mjs");
        return await decodeBase64AsWasm(wasm);
    },
    importName: "./query_compiler_fast_bg.js"
};
export function getPrismaClientClass() {
    return runtime.getPrismaClient(config);
}
//# sourceMappingURL=class.js.map