import { isValidUrl } from '../../utils/request';

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
  // path relative to current origin
  baseURL = window.location.host + baseURL;
}

const swagger = {
  swagger: '2.0',
  info: {
    description:
      'This documentation shows how to use DLA through command line use for a user. See Lightning Network Documentation for available paths.',
    version: '1.0.6',
    title: 'DIA Usage',
    termsOfService: '/terms-service',
    contact: { email: 'apiteam@lqwd.tech' },
    // license: {
    //   name: 'Apache 2.0',
    //   url: 'http://www.apache.org/licenses/LICENSE-2.0.html',
    // },
  },
  // host: baseURL,
  // TODO: if we have versioning, add here
  // basePath: '/v2',
  basePath: '/api',
  tags: [
    {
      name: 'Node',
      description: 'Everything about your LND Nodes',
      //   externalDocs: { description: 'Find out more', url: 'http://swagger.io' },
    },
    {
      name: 'Accounting',
      description: 'Everything about billing and payments',
    },
    { name: 'API KEY', description: 'Everything about API Key management' },
    {
      name: 'Settings',
      description: 'Everything about user settings and preferences',
    },
  ],
  // schemes: ['https', 'http'],
  paths: {
    '/lndnode/getlist': {
      get: {
        tags: ['Node'],
        summary: 'get list of all LNDs',
        description: '',
        // operationId: 'uploadFile',
        // consumes: ['multipart/form-data'],
        produces: ['application/json'],
        parameters: [],
        responses: {
          200: {
            description: 'successful operation',
            schema: { $ref: '#/definitions/ApiResponse' },
          },
        },
        security: [{ api_key: [] }],
      },
    },
    '/kubernetes/lnd_node/create': {
      post: {
        tags: ['Node'],
        summary: 'create LND',
        description: '',
        // operationId: 'uploadFile',
        // consumes: ['multipart/form-data'],
        produces: ['application/json'],
        parameters: [],
        responses: {
          200: {
            description: 'successful operation',
            schema: { $ref: '#/definitions/ApiResponse' },
          },
        },
        security: [{ api_key: [] }],
      },
    },
    '/lndnode/getinfo': {
      post: {
        tags: ['Node'],
        summary: 'Get LND info',
        description: '',
        // operationId: 'uploadFile',
        // consumes: ['multipart/form-data'],
        produces: ['application/json'],
        parameters: [],
        responses: {
          200: {
            description: 'successful operation',
            schema: { $ref: '#/definitions/ApiResponse' },
          },
        },
        security: [{ api_key: [] }],
      },
    },
    '/api/v1/node/info': {
      get: {
        tags: ['Accounting'],
        summary: 'get node billing info',
        description: 'This can only be done by the logged in user.',
        consumes: ['application/json'],
        produces: ['application/json', 'application/xml'],
        responses: { default: { description: 'successful operation' } },
        security: [{ api_key: [] }],
      },
    },
    '/api/v1/subscription/products': {
      get: {
        tags: ['Accounting'],
        summary: 'get list of all subscriptions',
        description: 'This can only be done by the logged in user.',
        consumes: ['application/json'],
        produces: ['application/json', 'application/xml'],
        responses: { default: { description: 'successful operation' } },
        security: [{ api_key: [] }],
      },
    },
    '/api/v1/subscription': {
      get: {
        tags: ['Accounting'],
        summary: 'get active subscription',
        description: 'This can only be done by the logged in user.',
        consumes: ['application/json'],
        produces: ['application/json', 'application/xml'],
        responses: { default: { description: 'successful operation' } },
        security: [{ api_key: [] }],
      },
      post: {
        tags: ['Accounting'],
        summary: 'make new subscription',
        description: 'This can only be done by the logged in user.',
        consumes: ['application/json'],
        produces: ['application/json', 'application/xml'],
        responses: { default: { description: 'successful operation' } },
        security: [{ api_key: [] }],
      },
    },
    '/api/v1/invoices': {
      get: {
        tags: ['Accounting'],
        summary: 'get invoices',
        description: 'This can only be done by the logged in user.',
        consumes: ['application/json'],
        produces: ['application/json', 'application/xml'],
        responses: { default: { description: 'successful operation' } },
        security: [{ api_key: [] }],
      },
    },
    '/setting/apikey/getlist': {
      post: {
        tags: ['API KEY'],
        summary: 'Get list of API keys',
        description: 'This can only be done by the logged in user.',
        consumes: ['application/json'],
        produces: ['application/json', 'application/xml'],
        responses: { default: { description: 'successful operation' } },
        security: [{ api_key: [] }],
      },
    },
    '/setting/apikey/history': {
      post: {
        tags: ['API KEY'],
        summary: 'Get list of API keys',
        description: 'This can only be done by the logged in user.',
        consumes: ['application/json'],
        produces: ['application/json', 'application/xml'],
        responses: { default: { description: 'successful operation' } },
        security: [{ api_key: [] }],
        parameters: [
          {
            name: 'info',
            in: 'body',
            description: '',
            required: true,
            schema: {
              type: 'object',
              required: ['apikey, page, size'],
              properties: {
                apikey: { type: 'string' },
                page: { type: 'string' },
                size: { type: 'string' },
              },
            },
          },
        ],
      },
    },
    'setting/apikey/generate': {
      post: {
        tags: ['API KEY'],
        summary: 'Generate API Key',
        description: 'This can only be done by the logged in user.',
        consumes: ['application/json'],
        produces: ['application/json', 'application/xml'],
        responses: { default: { description: 'successful operation' } },
        security: [{ api_key: [] }],
      },
    },
  },
  securityDefinitions: {
    // we use api interceptor to add token to each api call, so no need to authorize as long as user is logged in
    api_key: {
      type: 'apiKey',
      name: 'Authorization',
      in: 'header',
      description:
        'Enter the token with the `Bearer: ` prefix, e.g. "Bearer abcde12345".',
    },
    // petstore_auth: {
    //  type: 'oauth2',
    //  authorizationUrl: 'https://petstore.swagger.io/oauth/authorize',
    //  flow: 'implicit',
    //  scopes: {
    //    'read:pets': 'read your pets',
    //   'write:pets': 'modify pets in your account',
    //  },
    // },
    // bearerAuth: {
    //  type: 'basic',
    // },
  },
  definitions: {
    ApiResponse: {
      type: 'object',
      properties: {
        status: { type: 'integer', format: 'int32' },
        type: { type: 'string' },
        object: {
          type: 'object',
          properties: {
            lndNodeName: { type: 'string' },
          },
        },
      },
    },
  },
  // externalDocs: {
  //   description: 'Find out more about Swagger',
  //   url: 'http://swagger.io',
  // },
};

export default swagger;
