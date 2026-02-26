module.exports = (req, res) => {
  res.json({ 
    maintenance: process.env.MAINTENANCE_MODE === 'true' 
  });
};
