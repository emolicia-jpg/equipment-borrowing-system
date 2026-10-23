USE equipment_borrowing_system;

INSERT INTO departments (code, name) VALUES
  ('CAS', 'College of Arts and Sciences'),
  ('CCS', 'College of Computer Studies'),
  ('CEA', 'College of Engineering and Architecture'),
  ('CHS', 'College of Health Sciences'),
  ('CTDE', 'College of Technological and Developmental Education'),
  ('CTHBM', 'College of Tourism, Hospitality and Business Management'),
  ('GS', 'Graduate School')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO equipment (name, category, total_quantity, available_qty, `condition`, status, department_id)
SELECT catalog.name, catalog.category, 2, 2, 'Good', 'Available', departments.id
FROM (
  SELECT 'CAS' AS department_code, 'Digital microscope' AS name, 'Science laboratory' AS category
  UNION ALL SELECT 'CAS', 'Compound microscope', 'Science laboratory'
  UNION ALL SELECT 'CAS', 'Digital pH meter', 'Science laboratory'
  UNION ALL SELECT 'CAS', 'Digital weighing scale', 'Science laboratory'
  UNION ALL SELECT 'CAS', 'Binoculars', 'Field research'
  UNION ALL SELECT 'CAS', 'Portable audio recorder', 'Field research'
  UNION ALL SELECT 'CAS', 'DSLR camera', 'Media equipment'
  UNION ALL SELECT 'CAS', 'Camera tripod', 'Media equipment'
  UNION ALL SELECT 'CAS', 'Portable projector', 'Presentation equipment'
  UNION ALL SELECT 'CAS', 'Wireless presentation microphone', 'Presentation equipment'
  UNION ALL SELECT 'CCS', 'Laptop computer', 'Computing equipment'
  UNION ALL SELECT 'CCS', 'Desktop computer', 'Computing equipment'
  UNION ALL SELECT 'CCS', 'Managed network switch', 'Networking equipment'
  UNION ALL SELECT 'CCS', 'Wireless router', 'Networking equipment'
  UNION ALL SELECT 'CCS', 'Raspberry Pi development kit', 'Computer hardware'
  UNION ALL SELECT 'CCS', 'Arduino development kit', 'Computer hardware'
  UNION ALL SELECT 'CCS', 'External solid-state drive', 'Storage'
  UNION ALL SELECT 'CCS', 'Webcam', 'Computer peripherals'
  UNION ALL SELECT 'CCS', 'Portable projector', 'Presentation equipment'
  UNION ALL SELECT 'CCS', 'Uninterruptible power supply', 'Power equipment'
  UNION ALL SELECT 'CEA', 'Digital multimeter', 'Electrical instruments'
  UNION ALL SELECT 'CEA', 'Digital oscilloscope', 'Electrical instruments'
  UNION ALL SELECT 'CEA', 'Soldering station', 'Electrical tools'
  UNION ALL SELECT 'CEA', 'Vernier caliper set', 'Measurement tools'
  UNION ALL SELECT 'CEA', 'Laser distance meter', 'Surveying tools'
  UNION ALL SELECT 'CEA', 'Clamp meter', 'Electrical instruments'
  UNION ALL SELECT 'CEA', 'Cordless power drill', 'Workshop tools'
  UNION ALL SELECT 'CEA', 'Arduino engineering kit', 'Engineering kits'
  UNION ALL SELECT 'CEA', 'Construction safety helmet', 'Safety equipment'
  UNION ALL SELECT 'CEA', 'Measuring tape set', 'Surveying tools'
  UNION ALL SELECT 'CHS', 'Stethoscope', 'Clinical equipment'
  UNION ALL SELECT 'CHS', 'Digital blood pressure monitor', 'Clinical equipment'
  UNION ALL SELECT 'CHS', 'Pulse oximeter', 'Clinical equipment'
  UNION ALL SELECT 'CHS', 'Digital clinical thermometer', 'Clinical equipment'
  UNION ALL SELECT 'CHS', 'CPR training manikin', 'Nursing simulation'
  UNION ALL SELECT 'CHS', 'Manual wheelchair', 'Patient care'
  UNION ALL SELECT 'CHS', 'Portable nebulizer', 'Patient care'
  UNION ALL SELECT 'CHS', 'First aid training kit', 'First aid equipment'
  UNION ALL SELECT 'CHS', 'Digital patient weighing scale', 'Clinical equipment'
  UNION ALL SELECT 'CHS', 'Examination lamp', 'Clinical equipment'
  UNION ALL SELECT 'CTDE', 'Laptop computer', 'Teaching technology'
  UNION ALL SELECT 'CTDE', 'Portable projector', 'Teaching technology'
  UNION ALL SELECT 'CTDE', 'Document camera', 'Teaching technology'
  UNION ALL SELECT 'CTDE', 'Interactive presentation tablet', 'Teaching technology'
  UNION ALL SELECT 'CTDE', 'Portable classroom speaker', 'Audio equipment'
  UNION ALL SELECT 'CTDE', 'Wireless teaching microphone', 'Audio equipment'
  UNION ALL SELECT 'CTDE', 'Whiteboard easel', 'Classroom equipment'
  UNION ALL SELECT 'CTDE', 'Science teaching demonstration kit', 'Teaching aids'
  UNION ALL SELECT 'CTDE', 'Mathematics teaching manipulative kit', 'Teaching aids'
  UNION ALL SELECT 'CTDE', 'Classroom response clicker set', 'Teaching technology'
  UNION ALL SELECT 'CTHBM', 'Professional chef knife set', 'Culinary equipment'
  UNION ALL SELECT 'CTHBM', 'Digital food thermometer', 'Culinary equipment'
  UNION ALL SELECT 'CTHBM', 'Portable induction cooker', 'Culinary equipment'
  UNION ALL SELECT 'CTHBM', 'Commercial blender', 'Culinary equipment'
  UNION ALL SELECT 'CTHBM', 'Coffee grinder', 'Food and beverage equipment'
  UNION ALL SELECT 'CTHBM', 'Hotel housekeeping toolkit', 'Hospitality equipment'
  UNION ALL SELECT 'CTHBM', 'Portable luggage scale', 'Tourism equipment'
  UNION ALL SELECT 'CTHBM', 'Banquet serving set', 'Hospitality equipment'
  UNION ALL SELECT 'CTHBM', 'Portable point-of-sale terminal', 'Business equipment'
  UNION ALL SELECT 'CTHBM', 'Digital kitchen scale', 'Culinary equipment'
  UNION ALL SELECT 'GS', 'Laptop computer', 'Research technology'
  UNION ALL SELECT 'GS', 'Portable projector', 'Presentation equipment'
  UNION ALL SELECT 'GS', 'Conference speakerphone', 'Meeting equipment'
  UNION ALL SELECT 'GS', 'HD webcam', 'Research technology'
  UNION ALL SELECT 'GS', 'Portable solid-state drive', 'Research storage'
  UNION ALL SELECT 'GS', 'Digital voice recorder', 'Research equipment'
  UNION ALL SELECT 'GS', 'Camera tripod', 'Research equipment'
  UNION ALL SELECT 'GS', 'Wireless presentation microphone', 'Meeting equipment'
  UNION ALL SELECT 'GS', 'Document camera', 'Presentation equipment'
  UNION ALL SELECT 'GS', 'Laser presentation pointer', 'Presentation equipment'
) AS catalog
JOIN departments ON departments.code = catalog.department_code
WHERE NOT EXISTS (
  SELECT 1 FROM equipment existing
  WHERE existing.department_id = departments.id
    AND existing.name = catalog.name
);
