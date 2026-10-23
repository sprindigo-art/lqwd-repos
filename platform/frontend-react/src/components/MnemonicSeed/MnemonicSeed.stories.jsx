import React from 'react';
import SeedsModal from './MnemonicSeed';

export default {
  title: 'Lqwd/Mnemonic Seed',
  component: SeedsModal,
};

const seeds = [
  'scout', 'bunker', 'play', 'warfare',
  'topic', 'resource', 'game', 'baby',
  'uphold', 'bean', 'cruise', 'bulb',
  'stool', 'town', 'inhale', 'valve',
  'glare', 'globe', 'dad', 'hope',
  'confirm', 'multiply', 'husband', 'element'
]

const confirmationSeedsIndexes = [1, 11, 20];

const handleConfirm = () => {
  console.log('confirm')
}

export const primary = () => {
  return (
    <SeedsModal
      show={true}
      seeds={seeds}
      handleConfirm={handleConfirm}
      confirmationSeedsIndexes={confirmationSeedsIndexes}
    />
  );
};

export const loading = () => {
  return (
    <SeedsModal
      show={true}
      seeds={[]}
      handleConfirm={handleConfirm}
      confirmationSeedsIndexes={confirmationSeedsIndexes}
    />
  );
};

