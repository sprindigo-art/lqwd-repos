/*eslint-disable*/
import React from 'react';
import AddUserModal from "./AddUserModal";

export default {
  title: 'Components/Add User Modal',
  component: AddUserModal,
};

const options = [
  {value: 'canada', label: 'Canada'},
  {value: 'france', label: 'France'},
  {value: 'germany', label: 'Germany'},
  {value: 'usa', label: 'USA'},
]

const handleConfirm = (email, node, admin, manager, auditor, password) => {
  console.log(email, node, admin, manager, auditor, password);
};

export const primary = () => {
  return (
    <AddUserModal show={true} nodeList={options} onConfirm={handleConfirm}/>
  );
};