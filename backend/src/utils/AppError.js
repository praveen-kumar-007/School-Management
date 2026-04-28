class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.isOperational = true;
  }
}

export default AppError;
