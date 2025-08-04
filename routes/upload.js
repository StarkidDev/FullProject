const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/supabase');
const { authenticateToken, requireApprovedOrganizer } = require('../middleware/auth');

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Upload event banner
router.post('/event-banner', authenticateToken, requireApprovedOrganizer, upload.single('banner'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const fileExt = file.originalname.split('.').pop();
    const fileName = `${uuidv4()}.${fileExt}`;
    const filePath = `banners/${fileName}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('event-banners')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        duplex: false
      });

    if (error) {
      console.error('Supabase upload error:', error);
      return res.status(400).json({ 
        error: 'Failed to upload image', 
        message: error.message 
      });
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('event-banners')
      .getPublicUrl(filePath);

    res.json({
      message: 'Image uploaded successfully',
      url: publicUrl,
      path: filePath,
      filename: fileName
    });

  } catch (error) {
    console.error('Upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum size is 5MB.' });
    }
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Upload contestant image
router.post('/contestant-image', authenticateToken, requireApprovedOrganizer, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const fileExt = file.originalname.split('.').pop();
    const fileName = `${uuidv4()}.${fileExt}`;
    const filePath = `contestants/${fileName}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('contestant-images')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        duplex: false
      });

    if (error) {
      console.error('Supabase upload error:', error);
      return res.status(400).json({ 
        error: 'Failed to upload image', 
        message: error.message 
      });
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('contestant-images')
      .getPublicUrl(filePath);

    res.json({
      message: 'Image uploaded successfully',
      url: publicUrl,
      path: filePath,
      filename: fileName
    });

  } catch (error) {
    console.error('Upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum size is 5MB.' });
    }
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Upload multiple contestant images
router.post('/contestant-images', authenticateToken, requireApprovedOrganizer, upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadPromises = req.files.map(async (file) => {
      const fileExt = file.originalname.split('.').pop();
      const fileName = `${uuidv4()}.${fileExt}`;
      const filePath = `contestants/${fileName}`;

      const { data, error } = await supabase.storage
        .from('contestant-images')
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          duplex: false
        });

      if (error) {
        throw new Error(`Failed to upload ${file.originalname}: ${error.message}`);
      }

      const { data: { publicUrl } } = supabase.storage
        .from('contestant-images')
        .getPublicUrl(filePath);

      return {
        originalName: file.originalname,
        url: publicUrl,
        path: filePath,
        filename: fileName
      };
    });

    const results = await Promise.all(uploadPromises);

    res.json({
      message: `${results.length} images uploaded successfully`,
      images: results
    });

  } catch (error) {
    console.error('Bulk upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'One or more files exceed the 5MB size limit.' });
    }
    res.status(500).json({ error: error.message || 'Failed to upload images' });
  }
});

// Delete uploaded image
router.delete('/image', authenticateToken, requireApprovedOrganizer, async (req, res) => {
  try {
    const { path, bucket } = req.body;

    if (!path || !bucket) {
      return res.status(400).json({ error: 'Path and bucket are required' });
    }

    // Validate bucket
    const allowedBuckets = ['event-banners', 'contestant-images'];
    if (!allowedBuckets.includes(bucket)) {
      return res.status(400).json({ error: 'Invalid bucket specified' });
    }

    // Delete from Supabase Storage
    const { error } = await supabase.storage
      .from(bucket)
      .remove([path]);

    if (error) {
      console.error('Supabase delete error:', error);
      return res.status(400).json({ 
        error: 'Failed to delete image', 
        message: error.message 
      });
    }

    res.json({ message: 'Image deleted successfully' });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Get upload URL for direct upload (alternative approach)
router.get('/upload-url/:type', authenticateToken, requireApprovedOrganizer, async (req, res) => {
  try {
    const { type } = req.params;
    const { filename, contentType } = req.query;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'Filename and contentType are required' });
    }

    // Validate type and set bucket
    let bucket;
    switch (type) {
      case 'event-banner':
        bucket = 'event-banners';
        break;
      case 'contestant-image':
        bucket = 'contestant-images';
        break;
      default:
        return res.status(400).json({ error: 'Invalid upload type' });
    }

    // Validate content type
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image files are allowed' });
    }

    // Generate unique filename
    const fileExt = filename.split('.').pop();
    const uniqueFilename = `${uuidv4()}.${fileExt}`;
    const filePath = type === 'event-banner' ? `banners/${uniqueFilename}` : `contestants/${uniqueFilename}`;

    // Create signed URL for upload
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(filePath);

    if (error) {
      console.error('Signed URL error:', error);
      return res.status(400).json({ 
        error: 'Failed to create upload URL', 
        message: error.message 
      });
    }

    // Get the eventual public URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    res.json({
      uploadUrl: data.signedUrl,
      publicUrl,
      path: filePath,
      filename: uniqueFilename,
      expiresIn: 3600 // 1 hour
    });

  } catch (error) {
    console.error('Upload URL error:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// Get image info
router.get('/image/info', authenticateToken, async (req, res) => {
  try {
    const { path, bucket } = req.query;

    if (!path || !bucket) {
      return res.status(400).json({ error: 'Path and bucket are required' });
    }

    // Validate bucket
    const allowedBuckets = ['event-banners', 'contestant-images'];
    if (!allowedBuckets.includes(bucket)) {
      return res.status(400).json({ error: 'Invalid bucket specified' });
    }

    // Get file info from Supabase Storage
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(path.split('/')[0], {
        search: path.split('/')[1]
      });

    if (error) {
      console.error('File info error:', error);
      return res.status(400).json({ 
        error: 'Failed to get file info', 
        message: error.message 
      });
    }

    const fileInfo = data?.[0];
    if (!fileInfo) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    res.json({
      name: fileInfo.name,
      size: fileInfo.metadata?.size,
      contentType: fileInfo.metadata?.mimetype,
      lastModified: fileInfo.updated_at,
      publicUrl,
      path
    });

  } catch (error) {
    console.error('Image info error:', error);
    res.status(500).json({ error: 'Failed to get image info' });
  }
});

// List uploaded images for organizer
router.get('/images', authenticateToken, requireApprovedOrganizer, async (req, res) => {
  try {
    const { bucket, folder, limit = 50 } = req.query;

    // Validate bucket
    const allowedBuckets = ['event-banners', 'contestant-images'];
    if (bucket && !allowedBuckets.includes(bucket)) {
      return res.status(400).json({ error: 'Invalid bucket specified' });
    }

    const bucketsToSearch = bucket ? [bucket] : allowedBuckets;
    const results = {};

    for (const bucketName of bucketsToSearch) {
      const { data, error } = await supabase.storage
        .from(bucketName)
        .list(folder || '', {
          limit: parseInt(limit),
          sortBy: { column: 'updated_at', order: 'desc' }
        });

      if (error) {
        console.error(`Error listing ${bucketName}:`, error);
        results[bucketName] = { error: error.message };
        continue;
      }

      results[bucketName] = data.map(file => {
        const { data: { publicUrl } } = supabase.storage
          .from(bucketName)
          .getPublicUrl(folder ? `${folder}/${file.name}` : file.name);

        return {
          name: file.name,
          size: file.metadata?.size,
          contentType: file.metadata?.mimetype,
          lastModified: file.updated_at,
          publicUrl,
          path: folder ? `${folder}/${file.name}` : file.name
        };
      });
    }

    res.json(results);

  } catch (error) {
    console.error('List images error:', error);
    res.status(500).json({ error: 'Failed to list images' });
  }
});

module.exports = router;