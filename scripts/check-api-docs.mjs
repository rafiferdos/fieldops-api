import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  REDIRECT_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { PUBLIC_ROUTE } from '../dist/modules/auth/decorators/public.decorator.js';
import { ROUTE_ROLES } from '../dist/modules/auth/decorators/roles.decorator.js';

// Offline contract check: use the compiled Nest routes and their actual validation pipes.
// Never instantiate the application, call a gateway, connect a DB or read credentials.
const root = fileURLToPath(new URL('../', import.meta.url));
const collection = JSON.parse(
  await readFile(join(root, 'docs/fieldops.postman_collection.json'), 'utf8'),
);
assert.equal(
  collection.info.schema,
  'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
);
const variables = new Map(
  collection.variable.map((variable) => [variable.key, variable.value]),
);
for (const [key, value] of variables)
  if (/password|token|credential|validation_id|merchant_tran_id/.test(key))
    assert.equal(
      value,
      '',
      `Documentation must not contain populated secrets: ${key}`,
    );

const examples = {
  ...Object.fromEntries(variables),
  customer_email: 'customer@example.com',
  registration_email: 'registration@example.com',
  admin_email: 'admin@example.com',
  technician_email: 'technician@example.com',
  customer_password: 'Example local test passphrase',
  registration_password: 'Example local test passphrase',
  admin_password: 'Example local test passphrase',
  technician_password: 'Example local test passphrase',
  refresh_token: 'a'.repeat(43),
  google_credential: 'example-input-token-for-validation-only'.repeat(3),
  preferred_start: '2099-01-01T10:00:00+06:00',
  visit_start: '2099-01-01T10:00:00+06:00',
  visit_end: '2099-01-01T11:00:00+06:00',
  reschedule_start: '2099-01-02T10:00:00+06:00',
  reschedule_end: '2099-01-02T11:00:00+06:00',
  idempotency_key: '11111111-1111-4111-8111-111111111111',
  merchant_tran_id: 'a'.repeat(24),
  validation_id: 'example-provider-validation',
};
for (const key of variables.keys())
  if (key.endsWith('_id') && !(key in examples && examples[key]))
    examples[key] = '11111111-1111-4111-8111-111111111111';

function resolve(text) {
  return text.replace(/\{\{([^{}]+)\}\}/g, (_match, key) => {
    assert(
      Object.hasOwn(examples, key),
      `Unknown documentation variable: ${key}`,
    );
    return examples[key];
  });
}
async function controllerFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await controllerFiles(path)));
    else if (entry.name.endsWith('.controller.js')) files.push(path);
  }
  return files;
}
const routes = new Map();
for (const path of await controllerFiles(join(root, 'dist/modules'))) {
  const exported = await import(pathToFileURL(path).href);
  for (const controller of Object.values(exported)) {
    if (typeof controller !== 'function') continue;
    const prefix = Reflect.getMetadata(PATH_METADATA, controller);
    if (typeof prefix !== 'string') continue;
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      if (name === 'constructor') continue;
      const handler = controller.prototype[name];
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;
      const suffix = Reflect.getMetadata(PATH_METADATA, handler);
      const route =
        '/' +
        [prefix, suffix]
          .flatMap((part) => part.split('/'))
          .filter(Boolean)
          .join('/');
      const key = `${RequestMethod[method]} ${route}`;
      const redirect = Reflect.getMetadata(REDIRECT_METADATA, handler);
      assert(!routes.has(key), `Duplicate implemented route: ${key}`);
      routes.set(key, {
        public:
          Reflect.getMetadata(PUBLIC_ROUTE, handler) ??
          Reflect.getMetadata(PUBLIC_ROUTE, controller) ??
          false,
        roles: Reflect.getMetadata(ROUTE_ROLES, handler) ??
          Reflect.getMetadata(ROUTE_ROLES, controller) ?? [
            'CUSTOMER',
            'TECHNICIAN',
            'ADMIN',
          ],
        status:
          redirect?.statusCode ??
          Reflect.getMetadata(HTTP_CODE_METADATA, handler) ??
          (method === RequestMethod.POST ? 201 : 200),
        args: Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {},
        redirect: !!redirect,
      });
    }
  }
}
function requests(items) {
  return items.flatMap((item) => (item.item ? requests(item.item) : [item]));
}
const covered = new Set();
let checked = 0;
for (const item of requests(collection.item)) {
  const request = item.request;
  assert(
    request.url.raw.startsWith('{{base_url}}/'),
    `Unexpected documentation URL: ${item.name}`,
  );
  const documentedPath = request.url.path.join('/');
  const routePath =
    '/' +
    documentedPath
      .replace(/\{\{[a-z_]+_id\}\}/g, ':id')
      .replace(
        /sslcommerz\/return\/(success|fail|cancel)$/,
        'sslcommerz/return/:kind',
      );
  const key = `${request.method} ${routePath}`;
  const route = routes.get(key);
  assert(route, `Documented route is not implemented: ${key}`);
  covered.add(key);
  assert(
    item.request.description.length > 100,
    `Missing domain instructions: ${key}`,
  );
  assert(
    item.response.some((response) => response.code === route.status),
    `Missing expected success status ${route.status}: ${key}`,
  );
  for (const response of item.response) {
    // Browser returns carry a Location header, not a fabricated JSON success body.
    if (route.redirect && response.code === route.status) {
      assert.equal(response.body, '');
      const location = response.header.find(
        (header) => header.key.toLowerCase() === 'location',
      )?.value;
      assert(location, 'Missing browser return destination');
      const url = new URL(resolve(location));
      assert(['/payment/success', '/payment/cancel'].includes(url.pathname));
      assert.equal(url.searchParams.get('paymentId'), examples.payment_id);
      assert.equal(url.searchParams.size, 1);
      continue;
    }
    const body = JSON.parse(response.body);
    assert(
      Number.isInteger(response.code) &&
        response.code >= 200 &&
        response.code <= 599,
      `Invalid example HTTP status: ${item.name}/${response.name}`,
    );
    assert.equal(body.success, response.code < 400);
    assert(typeof body.message === 'string' && body.message.length > 0);
    if (body.success) assert(Object.hasOwn(body, 'data'));
    else {
      assert(Array.isArray(body.errors));
      assert(body.errors.every((error) => typeof error === 'string'));
      assert(!Object.hasOwn(body, 'data'));
    }
  }
  if (route.public)
    assert.equal(
      request.auth.type,
      'noauth',
      `Public route must use No Auth: ${key}`,
    );
  else {
    assert.equal(request.auth.type, 'bearer', `Missing Bearer auth: ${key}`);
    const token = request.auth.bearer.find(
      (field) => field.key === 'token',
    )?.value;
    const role = {
      '{{access_token}}': 'CUSTOMER',
      '{{admin_access_token}}': 'ADMIN',
      '{{technician_access_token}}': 'TECHNICIAN',
    }[token];
    assert(
      role && route.roles.includes(role),
      `Example Bearer role is forbidden: ${key}`,
    );
  }
  const headers = Object.fromEntries(
    request.header.map((header) => [
      header.key.toLowerCase(),
      resolve(header.value),
    ]),
  );
  const query = Object.fromEntries(
    (request.url.query ?? [])
      .filter((parameter) => !parameter.disabled)
      .map((parameter) => [parameter.key, resolve(parameter.value)]),
  );
  const pathParts = routePath.split('/');
  const requestParts = documentedPath.split('/');
  const params = {};
  for (let i = 0; i < pathParts.length; i++)
    if (pathParts[i].startsWith(':'))
      params[pathParts[i].slice(1)] = resolve(requestParts[i - 1]);
  const body =
    request.body?.mode === 'raw'
      ? JSON.parse(resolve(request.body.raw))
      : request.body?.mode === 'urlencoded'
        ? Object.fromEntries(
            request.body.urlencoded
              .filter((field) => !field.disabled)
              .map((field) => [field.key, resolve(field.value)]),
          )
        : request.body?.mode === 'formdata'
          ? Object.fromEntries(
              request.body.formdata
                .filter((field) => field.type === 'text' && !field.disabled)
                .map((field) => [field.key, resolve(field.value)]),
            )
          : undefined;
  const httpRequest = { headers, query, params, body };
  for (const [argumentKey, argument] of Object.entries(route.args)) {
    if (!argument.pipes?.length) continue;
    const type = Number(argumentKey.split(':')[0]);
    const value = argument.factory
      ? argument.factory(argument.data, {
          switchToHttp: () => ({ getRequest: () => httpRequest }),
        })
      : type === RouteParamtypes.BODY
        ? body
        : type === RouteParamtypes.QUERY
          ? query
          : type === RouteParamtypes.PARAM
            ? params[argument.data]
            : type === RouteParamtypes.HEADERS
              ? headers[argument.data]
              : undefined;
    for (const pipe of argument.pipes) {
      await pipe.transform(value);
      // Disabled optional query examples must also remain valid when enabled in Apidog.
      if (
        type === RouteParamtypes.QUERY &&
        request.url.query?.some((parameter) => parameter.disabled)
      )
        await pipe.transform(
          Object.fromEntries(
            request.url.query.map((parameter) => [
              parameter.key,
              resolve(parameter.value),
            ]),
          ),
        );
    }
  }
  checked++;
}
assert.deepEqual(
  [...covered].sort(),
  [...routes.keys()].sort(),
  'Documentation must cover every implemented route, with no planned/dummy endpoints',
);
console.log(
  `API documentation checked: ${checked} request examples, ${covered.size} implemented routes; authorization/status metadata and real validation pipes match`,
);
