export class AppError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message, extra) => new AppError(400, 'bad_request', message, extra);
export const unauthorized = (message = 'Silakan masuk dulu.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Anda tidak punya izin untuk ini.') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Data tidak ditemukan.') => new AppError(404, 'not_found', message);
export const conflict = (message, extra) => new AppError(409, 'conflict', message, extra);
export const unprocessable = (message, extra) => new AppError(422, 'unprocessable', message, extra);
