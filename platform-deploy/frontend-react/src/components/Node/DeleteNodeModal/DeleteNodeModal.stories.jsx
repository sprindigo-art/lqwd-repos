import React from 'react';
import DeleteNodeModal from './DeleteNodeModal';
import { nodes } from '../NodeStorybookExample'

export default {
  title: 'Lqwd Node/Delete Node Modal',
  component: DeleteNodeModal,
};


const handleConfirm = ({ password, passphrase }) => {
  console.log('confirm: password: ' + password);
  console.log('confirm: passphrase: ' + passphrase);
}
const goBack = () => {
  console.log('going to previous step');
}

const handleHide = () => {
  console.log('closing');
}


export const noneZeroBalance = () => {
  return (
    <DeleteNodeModal
      show={true}
      handleConfirm={handleConfirm}
      goBack={goBack}
      handleHide={handleHide}
      node={nodes[0]}
      status={nodes[0].status}
    />
  );
};

export const waitingForResponse = () => {
  return (
    <DeleteNodeModal
      show={true}
      handleConfirm={handleConfirm}
      goBack={goBack}
      handleHide={handleHide}
      node={nodes[1]}
      status={nodes[1].status}
      disableDelete={true}
    />
  );
};

export const passphrase = () => {
  return (
    <DeleteNodeModal
      show={true}
      handleConfirm={handleConfirm}
      goBack={goBack}
      handleHide={handleHide}
      node={nodes[1]}
      status={nodes[1].status}
    />
  );
};

export const zeroBalance = () => {
  return (
    <DeleteNodeModal
      show={true}
      handleConfirm={handleConfirm}
      goBack={goBack}
      handleHide={handleHide}
      node={nodes[3]}
      status={nodes[3].status}
    />
  );
};