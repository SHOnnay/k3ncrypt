import { Request, Response } from 'express';
export default (fn) => (req: Request, res: Response, next) => {
  Promise.resolve(fn(req, res, next)).catch((e) => {
    if (process.env.NODE_ENV !== 'production') {
        console.error(e instanceof Error ? e.message : 'Unhandled request error');
    }
    const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : e.message;
    return res.status(500).send({ error: message });
  });
};
