let ioInstance = null;

export const setRealtimeServer = (io) => {
  ioInstance = io;
};

export const getRealtimeServer = () => ioInstance;

export const emitStudentSync = (studentMongoId, event, payload) => {
  if (!ioInstance || !studentMongoId) return;
  ioInstance.to(`student:${studentMongoId}`).emit(event, payload);
};

export const emitCourseSync = (mongoCourseId, event, payload) => {
  if (!ioInstance || !mongoCourseId) return;
  ioInstance.to(`course:${mongoCourseId}`).emit(event, payload);
};
