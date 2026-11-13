/**
 * Request validation middleware using Zod schemas
 * @param {object} schemas - Object containing optional body, query, and params Zod schemas
 */
function validate({ body, query, params } = {}) {
  return async (req, res, next) => {
    try {
      if (body) {
        req.body = await body.parseAsync(req.body);
      }
      if (query) {
        req.query = await query.parseAsync(req.query);
      }
      if (params) {
        req.params = await params.parseAsync(req.params);
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = validate;
