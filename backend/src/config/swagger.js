import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const swaggerEnabled = process.env.ENABLE_SWAGGER === 'true';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'E-Learning Backend API',
      version: '1.0.0',
      description: 'API documentation for E-Learning backend services'
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:5000',
        description: 'Local server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },
  apis: ['./src/routes/*.js']
};

export const swaggerSpec = swaggerEnabled ? swaggerJsdoc(options) : null;
export const swaggerMiddleware = swaggerEnabled
  ? [swaggerUi.serve, swaggerUi.setup(swaggerSpec)]
  : [];
