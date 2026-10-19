export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
export const conflict = (message: string) => new ApiError(409, 'CONFLICT', message)
export const notFound = () => new ApiError(404, 'NOT_FOUND', '요청한 리소스를 찾을 수 없습니다.')
