const publicOrigin = process.env.PROJECT_LOG_PUBLIC_ORIGIN && new URL(process.env.PROJECT_LOG_PUBLIC_ORIGIN).origin;

module.exports = { publicOrigin };
