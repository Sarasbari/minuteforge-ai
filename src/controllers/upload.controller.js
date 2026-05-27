const logger = require('../utils/logger');

/**
 * Controller to handle POST /upload requests
 */
const handleUpload = (req, res, next) => {
  try {
    // If multer file filter didn't fail but no file was uploaded (e.g. wrong form field name)
    if (!req.file) {
      const error = new Error('No file uploaded. Make sure the multipart field name is "file".');
      error.status = 400;
      return next(error);
    }

    // Log the file details
    logger.info(`Upload successful: filename="${req.file.filename}", mimetype="${req.file.mimetype}", size=${req.file.size} bytes`);

    // Return success response
    res.status(200).json({
      success: true,
      filename: req.file.filename
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  handleUpload
};
