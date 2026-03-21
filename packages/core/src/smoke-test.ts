// @ts-nocheck
import { generateIdentity, computeSafetyNumber } from './crypto/identity.js';
import sodium from 'libsodium-wrappers';

async function test() {
  await sodium.ready;
  console.log('Testing Identity Generation...');
  const idA = await generateIdentity();
  const idB = await generateIdentity();
  
  console.log('Alice PeerID:', idA.peerId);
  console.log('Bob PeerID:', idB.peerId);
  
  const sn = computeSafetyNumber(idA, idB.signingKeyPair.publicKey);
  console.log('Safety Number:', sn);
  
  if (sn.length === 60) {
    console.log('✅ Identity Test Passed');
  } else {
    console.error('❌ Identity Test Failed');
    process.exit(1);
  }
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});
