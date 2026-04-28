import mongoose from 'mongoose';

const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a course title'],
      trim: true,
      maxlength: [100, 'Title cannot be more than 100 characters']
    },
    description: {
      type: String,
      required: [true, 'Please provide a course description'],
      maxlength: [2000, 'Description cannot be more than 2000 characters']
    },
    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    thumbnail: {
      type: String,
      default: null
    },
    category: {
      type: String,
      enum: ['programming', 'design', 'business', 'science', 'arts', 'other'],
      default: 'other'
    },
    level: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'beginner'
    },
    duration: {
      type: String,
      default: '0 weeks'
    },
    price: {
      type: Number,
      default: 0
    },
    assignments: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assignment'
    }],
    quizzes: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz'
    }],
    students: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    modules: [{
      title: String,
      description: String,
      lessons: [{
        title: String,
        videoUrl: String,
        pdfUrl: String,
        duration: String,
        content: String,
        notesText: String,
        noteAttachments: [{
          title: String,
          url: String
        }]
      }]
    }],
    contentFolders: [{
      name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120
      },
      description: {
        type: String,
        default: ''
      },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      },
      materials: [{
        type: {
          type: String,
          enum: ['pdf', 'video', 'note'],
          required: true
        },
        title: {
          type: String,
          required: true,
          trim: true,
          maxlength: 180
        },
        description: {
          type: String,
          default: ''
        },
        fileName: {
          type: String,
          default: null
        },
        fileSize: {
          type: Number,
          default: 0
        },
        mimeType: {
          type: String,
          default: null
        },
        latestFileUrl: {
          type: String,
          default: null
        },
        latestPreviewUrl: {
          type: String,
          default: null
        },
        latestNotesText: {
          type: String,
          default: ''
        },
        currentVersion: {
          type: Number,
          default: 1
        },
        versions: [{
          versionNumber: {
            type: Number,
            required: true
          },
          fileUrl: {
            type: String,
            default: null
          },
          previewUrl: {
            type: String,
            default: null
          },
          notesText: {
            type: String,
            default: ''
          },
          fileName: {
            type: String,
            default: null
          },
          fileSize: {
            type: Number,
            default: 0
          },
          mimeType: {
            type: String,
            default: null
          },
          changeNote: {
            type: String,
            default: ''
          },
          uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
          },
          uploadedAt: {
            type: Date,
            default: Date.now
          }
        }],
        createdBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          default: null
        },
        createdAt: {
          type: Date,
          default: Date.now
        },
        updatedAt: {
          type: Date,
          default: Date.now
        }
      }],
      createdAt: {
        type: Date,
        default: Date.now
      },
      updatedAt: {
        type: Date,
        default: Date.now
      }
    }],
    isPublished: {
      type: Boolean,
      default: false
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    reviews: [{
      user: mongoose.Schema.Types.ObjectId,
      rating: Number,
      comment: String,
      createdAt: {
        type: Date,
        default: Date.now
      }
    }]
  },
  { timestamps: true }
);

courseSchema.index({ instructor: 1 });
courseSchema.index({ isPublished: 1 });
courseSchema.index({ category: 1 });
courseSchema.index({ level: 1 });
courseSchema.index({ title: 'text', description: 'text' });

const Course = mongoose.model('Course', courseSchema);

export default Course;
