const db = require('../backend/src/config/database');

async function seedFutureSlots() {
  const future = await db.query("SELECT count(*) as count FROM teacher_availability_slots WHERE start_timestamp > datetime('now');");
  if (future[0].count === 0) {
    await db.execute(`
      INSERT INTO teacher_availability_slots 
      (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active) 
      VALUES 
      (1, '2026-10-26', '10:00:00', '10:30:00', '2026-10-26 10:00:00', '2026-10-26 10:30:00', 0, 1),
      (1, '2026-10-26', '10:30:00', '11:00:00', '2026-10-26 10:30:00', '2026-10-26 11:00:00', 0, 1),
      (1, '2026-10-27', '14:00:00', '14:30:00', '2026-10-27 14:00:00', '2026-10-27 14:30:00', 0, 1),
      (1, '2026-10-28', '11:00:00', '11:30:00', '2026-10-28 11:00:00', '2026-10-28 11:30:00', 0, 1),
      (2, '2026-10-26', '14:00:00', '14:30:00', '2026-10-26 14:00:00', '2026-10-26 14:30:00', 0, 1),
      (2, '2026-10-27', '15:00:00', '15:30:00', '2026-10-27 15:00:00', '2026-10-27 15:30:00', 0, 1),
      (2, '2026-10-29', '09:30:00', '10:00:00', '2026-10-29 09:30:00', '2026-10-29 10:00:00', 0, 1);
    `);
    console.log('Future consultation slots successfully seeded.');
  } else {
    console.log(`Future slots already exist (${future[0].count} slots).`);
  }
}

seedFutureSlots().catch(console.error);
