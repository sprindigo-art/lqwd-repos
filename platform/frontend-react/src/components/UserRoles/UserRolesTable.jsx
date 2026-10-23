/* eslint-disable */
import React, { useState } from "react";
import './UserRolesTable.css';
import './UserRolesItem.css';
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableBody from "@mui/material/TableBody";
import TableContainer from "@mui/material/TableContainer";
import trashIcon from "../../public/icons/general/svg/TrashRed.svg";
import editIcon from "../../public/icons/general/svg/EditIcon.svg";
import { Modal } from "react-bootstrap";
import Select from "../Basic/Select";
import PrimaryButton from "../Buttons/PrimaryButton";
import InfoPanel from "../InfoPanel/InfoPanel";
import DangerOutlineButton from "../Buttons/DangerOutlineButton";
export default function UserRolesTable({sharedUserList, handleUpdate, handleDelete, roleList}) {

  const [role, setRole] = useState();
  const [email, setEmail] = useState("");
  const [node, setNode] = useState("");

  const [showUpdate, setShowUpdate] = useState(false);

  const [confirmModal, setConfirmModal] = useState(false);

  const onRoleSelect = (value) => {
    setRole(value);
  };

  const hideEditModal = () => {
    setEmail(undefined);
    setNode(undefined);
    setRole(undefined)
    setShowUpdate(false)
  };

  const handleEdit = (email, lndname) => {
    setEmail(email);
    setNode(lndname);
    setShowUpdate(true);
  };

  const hideConfirmModal = () => {
    setEmail(undefined);
    setNode(undefined);
    setRole(undefined)
    setConfirmModal(false);
  };

  const handleTrash = (email, node, role) => {
    console.log(`Clicked Trash for ${email}`);
    setEmail(email);
    setNode(node);
    setRole(role)
    setConfirmModal(true);
  };


  const renderRoleStatus = (status) => {
    if (status.toLowerCase() === "active") {
      return (
        <div className={"user-role-item-status user-role-item-status-active"}>
          {status.toUpperCase()}
        </div>
      );
    }else if (status.toLowerCase() === "inactive"){
      return (
        <div className={"user-role-item-status user-role-item-status-inactive"}>
          {status.toUpperCase()}
        </div>
      );
    }else if (status.toLowerCase() === "pending"){
      return (
        <div className={"user-role-item-status user-role-item-status-pending"}>
          {status.toUpperCase()}
        </div>
      );
    }else{
      return (
        <div className={"user-role-item-status"}>
          {status.toUpperCase()}
        </div>
      );
    }
  };

  return (
    <>
      <TableContainer component={Paper} className='d-none d-lg-block'>
        <Table sx={{ minWidth: 650 }} aria-label="simple table">
          <TableHead>
            <TableRow>
              <TableCell align="left">Email</TableCell>
              <TableCell align="left">Node</TableCell>
              <TableCell align="left">Status</TableCell>
              <TableCell align="left">Current Role</TableCell>
              <TableCell align="left">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sharedUserList.map((row) => (
              <TableRow
                sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                hover={true}
              >
                <TableCell align="left">{row.email}</TableCell>

                <TableCell align="left">{row.nodeName}</TableCell>

                <TableCell align="left">
                  {renderRoleStatus(row.role.status)}
                </TableCell>
                <TableCell align="left">
                  {renderRoleStatus(row.role.name)}
                </TableCell>
                <TableCell align="center">
                  <div className="row">
                    <div className="col-auto">
                      <img src={editIcon} width={"18px"} height={"18px"} onClick={() => handleEdit(row.email, row.nodeName)}/>
                    </div>
                    <div className="col-auto">
                      <img src={trashIcon} onClick={() => handleTrash(row.email, row.nodeName, row.role.name)}/>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Modal centered className="" show={showUpdate} onHide={() => hideEditModal()} backdrop='static' keyboard="False">
        <Modal.Header closeButton className="border-0 mx-2">
          <div className="">
            Update User Role for Shared Node Access
          </div>
        </Modal.Header>
        <Modal.Body className="mx-2">
          <Select label={"Select Privileges for User"}
                  placeholder={"Select Role for User..."}
                  options={roleList}
                  onChange={onRoleSelect} />
        </Modal.Body>
        <Modal.Footer>
          <PrimaryButton text={"Update"}
                         onClick={() => {
                           setShowUpdate(false);
                           handleUpdate(email, node, role);
                         }}
                         disabled={role === undefined}/>
        </Modal.Footer>
      </Modal>

      <Modal centered className="" show={confirmModal} onHide={() => hideConfirmModal()} backdrop='static' keyboard="False">
        <Modal.Header closeButton className="border-0 mx-2">
          <div className="">
            Are you sure you want to delete user access?
          </div>
        </Modal.Header>
        <Modal.Body className="mx-2">
          <InfoPanel
            error={true}
            text={"This Actions cannot is permanent and will require another " +
              "invite to be sent to ad user to node again."} />
        </Modal.Body>
        <Modal.Footer>
          <DangerOutlineButton text={"Remove User From Node"}
                         onClick={() => {
                           setConfirmModal(false);
                           handleDelete(email, node, role);
                         }} />
        </Modal.Footer>
      </Modal>
    </>
  );
}
