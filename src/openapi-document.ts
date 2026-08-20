import { OpenAPIObject } from '@nestjs/swagger';
import type {
  OperationObject,
  PathItemObject,
  ReferenceObject,
  ResponseObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

const HTTP_METHODS: Array<keyof Pick<
  PathItemObject,
  'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'
>> = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const TAG_DESCRIPTIONS: Record<string, string> = {
  'admin-auth': 'Administrator authentication and session management.',
  'admin-dashboard': 'Administrator dashboard metrics.',
  'admin-events': 'Administrator event setup and publishing.',
  'admin-legacy-migration': 'Import and verify events from the legacy platform.',
  'admin-myfatoorah': 'Administrator MyFatoorah payment operations.',
  'admin-orders': 'Administrator order management.',
  'admin-organizations': 'Administrator organization management.',
  'admin-payment-settings': 'Administrator payment gateway configuration.',
  'admin-promocodes': 'Administrator promocode management and insights.',
  'admin-reports': 'Administrator reporting and reconciliation.',
  'admin-roles': 'Administrator role and permission management.',
  'admin-staff': 'Administrator staff accounts and assignments.',
  artists: 'Public artist details.',
  blogs: 'Public blog content.',
  events: 'Public event search, details, schedules, and tickets.',
  footer: 'Public footer content.',
  health: 'Backend dependency health.',
  homepage: 'Public homepage sections and offers.',
  organizer: 'Organizer authentication and workspace APIs.',
  'organizer-auth': 'Organizer authentication and session management.',
  'organizer-workspace': 'Organizer dashboard and event access.',
  promocodes: 'Customer promocode validation.',
  'registration-form': 'Public registration forms and submissions.',
  venues: 'Public venue details.',
};

const ERROR_RESPONSE_SCHEMA = 'ErrorResponse';

function humanize(value: string): string {
  return value
    .replace(/Controller_/, '_')
    .split('_')
    .at(-1)!
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
}

function successDescription(status: string): string {
  if (status === '201') return 'Resource created successfully.';
  if (status === '202') return 'Request accepted for processing.';
  if (status === '204') return 'Request completed successfully with no response body.';
  return 'Request completed successfully.';
}

function errorResponse(description: string): ResponseObject {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: `#/components/schemas/${ERROR_RESPONSE_SCHEMA}` },
      },
    },
  };
}

function isReference(response: ResponseObject | ReferenceObject): response is ReferenceObject {
  return '$ref' in response;
}

function documentOperation(operation: OperationObject): void {
  if (!operation.summary) {
    operation.summary = humanize(operation.operationId ?? 'Request');
  }

  for (const [status, response] of Object.entries(operation.responses)) {
    if (response && !isReference(response) && !response.description.trim()) {
      response.description = successDescription(status);
    }
  }

  operation.responses['400'] ??= errorResponse(
    'The request is invalid or failed validation.',
  );
  operation.responses['500'] ??= errorResponse('An unexpected server error occurred.');

  if (operation.security?.length) {
    operation.responses['401'] ??= errorResponse(
      'Authentication is missing, invalid, or expired.',
    );
    operation.responses['403'] ??= errorResponse(
      'The authenticated user does not have the required permission.',
    );
  }
}

export function enrichOpenApiDocument(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas[ERROR_RESPONSE_SCHEMA] = {
    type: 'object',
    required: ['statusCode', 'message'],
    properties: {
      statusCode: {
        type: 'integer',
        example: 400,
        description: 'HTTP status code.',
      },
      message: {
        oneOf: [
          { type: 'string', example: 'The request is invalid.' },
          { type: 'array', items: { type: 'string' } },
        ],
        description: 'Human-readable error details.',
      },
      error: {
        type: 'string',
        example: 'Bad Request',
        description: 'HTTP error label when available.',
      },
    },
  };

  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (operation) documentOperation(operation);
    }
  }

  const usedTags = new Set(
    Object.values(document.paths).flatMap((pathItem) =>
      HTTP_METHODS.flatMap((method) => pathItem[method]?.tags ?? []),
    ),
  );
  document.tags = [...usedTags]
    .sort()
    .map((name) => ({ name, description: TAG_DESCRIPTIONS[name] ?? humanize(name) }));

  return document;
}
