import assert from 'node:assert/strict';
import { createLandingBay } from '../src/scene/night/landing-bay.ts';

const bay = createLandingBay();
const doors = bay.group.children.filter((o) => o.isGroup);
assert.equal(doors.length, 2);
bay.update(0, true, false);
assert.equal(doors[0].position.x, -3.1);
bay.update(1.2, true, true);
assert(doors[0].position.x < -9 && doors[1].position.x > 9, 'doors clear before launch');
assert(bay.group.position.z < 1, 'room stays in place until doors clear');
bay.update(3, true, true);
assert.equal(bay.group.visible, false, 'room removed after departure');
bay.update(.2, false, true);
assert.equal(doors[0].position.x, -3.1, 'reduced motion does not slide doors');
assert.equal(bay.group.position.z, 0, 'reduced motion does not travel');
bay.update(.4, false, true);
assert.equal(bay.group.visible, false, 'reduced motion fades bay away');
console.log('PASS landing bay: doors clear, departure ends, reduced motion fades without travel');
