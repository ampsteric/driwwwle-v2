const uuid = require('uuid').v4;
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Post = require('../models/Post.model');
const User = require('../models/User.model');
const Follower = require('../models/Follower.model');

const auth = require('../middleware/auth.middleware');
const upload = require('../middleware/imageUpload.middleware');

const {
  newLikeNotification,
  removeLikeNotification,
  newCommentNotification,
  removeCommentNotification,
} = require('../server-utils/notifications');

// @route   POST /api/posts
// @desc    Create a new post
router.post('/', auth, upload.array('images', 5), async (req, res) => {
  const { title, description, liveDemo, sourceCode, techStack } = req.body;

  if (req.files.length < 1) {
    return res.status(400).json({ msg: 'Atleast one image is required' });
  }

  try {
    const postObj = {
      user: req.userId,
      title,
      description,
      images: req.files.map((file) => file.path),
      liveDemo,
      techStack: JSON.parse(techStack),
    };
    if (sourceCode) postObj.sourceCode = sourceCode;
    const post = await new Post(postObj).save();
    res.status(201).json(post);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/posts
// @desc    Get all posts
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 12;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const total = await Post.countDocuments();

    const posts = await Post.find()
      .skip(startIndex)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('user');

    let next = null;
    if (endIndex < total) {
      next = page + 1;
    }

    res.status(200).json({ posts, next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/posts/feed
// @desc    Get posts of following users
router.get('/feed', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 12;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const user = await Follower.findOne({ user: req.userId }).select(
      '-followers'
    );

    const followingUsers = user.following.map((following) => following.user);

    const total = await Post.countDocuments({ user: { $in: followingUsers } });

    const posts = await Post.find({ user: { $in: followingUsers } })
      .skip(startIndex)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('user');

    let next = null;
    if (endIndex < total) {
      next = page + 1;
    }

    res.status(200).json({ posts, next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/profile/saves
// @desc    Get saved posts of user
router.get('/saves', auth, async (req, res) => {
  try {
    const saves = await Post.find({
      'saves.user': mongoose.Types.ObjectId(req.userId),
    }).populate('user');
    res.status(200).json(saves);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/posts/:postId
// @desc    Get a post by ID
router.get('/:postId', async (req, res) => {
  try {
    let post = await Post.findById(req.params.postId)
      .populate('user')
      .populate('comments.user');
    if (!post) {
      return res.status(404).json({ msg: 'Post not found' });
    }
    post.views++;
    post = await post.save();
    res.status(200).json(post);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   DELETE /api/posts/:postId
// @desc    Delete a post by ID
router.delete('/:postId', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ msg: 'Post not found' });
    }
    const user = await User.findById(req.userId);
    if (post.user.toString() === req.userId || user.role === 'root') {
      await post.remove();
      res.status(200).json({ msg: 'Post deleted' });
    } else {
      res
        .status(401)
        .json({ msg: 'You are not authorized to delete this post' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   PUT /api/posts/like/:postId
// @desc    Like or unlike a post
router.put('/like/:postId', auth, async (req, res) => {
  try {
    let post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ msg: 'Post not found' });
    }

    const isLiked =
      post.likes.filter((like) => like.user.toString() === req.userId).length >
      0;

    if (isLiked) {
      // Unlike the post if already liked
      const index = post.likes.findIndex(
        (like) => like.user.toString() === req.userId
      );
      post.likes.splice(index, 1);
      post = await post.save();

      // Remove like notification
      if (post.user.toString() !== req.userId) {
        await removeLikeNotification(
          post.user.toString(),
          req.userId,
          req.params.postId
        );
      }

      res.status(200).json(post);
    } else {
      // Like the post
      post.likes.unshift({ user: req.userId });
      post = await post.save();

      // Add like notification
      if (post.user.toString() !== req.userId) {
        await newLikeNotification(
          post.user.toString(),
          req.userId,
          req.params.postId
        );
      }

      res.status(200).json(post);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   PUT /api/posts/save/:postId
// @desc    Save or unsave a post
router.put('/save/:postId', auth, async (req, res) => {
  try {
    let post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ msg: 'Post not found' });
    }

    const isSaved =
      post.saves.filter((save) => save.user.toString() === req.userId).length >
      0;

    if (isSaved) {
      // Unsave the post if already saved
      const index = post.saves.findIndex(
        (save) => save.user.toString() === req.userId
      );
      post.saves.splice(index, 1);
      post = await post.save();
      res.status(200).json(post);
    } else {
      // Save the post
      post.saves.unshift({ user: req.userId });
      post = await post.save();
      res.status(200).json(post);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/posts/like/:postId
// @desc    Get likes of a post
router.get('/like/:postId', async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId).populate('likes.user');
    if (!post) {
      return res.status(404).json({ msg: 'Post not found' });
    }
    res.status(200).json(post.likes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/posts/comment/:postId
// @desc    Add a new comment to post
router.post('/comment/:postId', auth, async (req, res) => {
  try {
    if (req.body.text.length < 1) {
      return res
        .status(400)
        .json({ msg: 'Comment must be atleast 1 character long' });
    }

    let post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ msg: 'Post not found' });
    }

    const comment = {
      _id: uuid(),
      user: req.userId,
      text: req.body.text,
      date: Date.now(),
    };

    post.comments.unshift(comment);
    post = await post.save();

    post = await Post.populate(post, 'comments.user');

    if (post.user.toString() !== req.userId) {
      await newCommentNotification(
        post.user.toString(),
        req.userId,
        req.params.postId,
        comment._id,
        req.body.text
      );
    }

    res.status(201).json(post.comments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   DELETE /api/posts/comment/:postId/:commentId
// @desc    Delete a comment
router.delete('/comment/:postId/:commentId', auth, async (req, res) => {
  try {
    let post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ msg: 'Post not found' });
    }

    const comment = post.comments.find(
      (comment) => comment._id === req.params.commentId
    );
    if (!comment) {
      return res.status(404).json({ msg: 'Comment not found' });
    }

    const user = await User.findById(req.userId);

    if (comment.user.toString() === req.userId || user.role === 'root') {
      const index = post.comments.findIndex(
        (comment) => comment._id === req.params.commentId
      );
      post.comments.splice(index, 1);
      post = await post.save();

      post = await Post.populate(post, 'comments.user');

      if (post.user.toString() !== req.userId) {
        await removeCommentNotification(
          post.user.toString(),
          req.userId,
          req.params.postId,
          comment._id
        );
      }

      res.status(200).json(post.comments);
    } else {
      res
        .status(401)
        .json({ msg: 'You are not authorized to delete this comment' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
