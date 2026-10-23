/* eslint-disable */
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import DeleteNodeComponent from '../../components/Node/DeleteNodeModal/DeleteNodeModal';
import { hideDeleteNodeModal } from './DeleteNodeActions';
import { requestDestroyLNDNode } from '../../requests/Node'
import { findNodeByName, nextSelectedNode } from '../../managers/nodeManager/nodeManager'
import { changeSelectedNode, removeNode } from '../../managers/nodeManager/nodeActions';
import { hideNodeDetailsModal } from '../NodeDetails/NodeDetailsActions';
import { showActivateModal, getSeeds } from '../ActivateNode/ActivateNodeActions'
import { useSnackbar } from 'notistack';
import NotificationDuration from 'NotificationDuration'
import { useNavigate } from 'react-router-dom';

const DeleteNode = ({ ...rest }) => {
    const dispatch = useDispatch();
    const [disableDelete, setDisableDelete] = React.useState(false);
    const { enqueueSnackbar, closeSnackbar } = useSnackbar();
    const navigate = useNavigate();

    const nodeReducer = useSelector(state => state.nodeReducer);
    const nodeDetailsModal = useSelector(state => state.nodeDetailsReducer);
    const deleteNodeModalShow = useSelector(state => state.deleteNodeReducer.showModal);
    const selectedNode = findNodeByName(nodeReducer.nodeList, nodeDetailsModal.nodeName);

    const globalSelectedNodeName = useSelector(state => state.selectedNodeReducer.nodeName);

    if (!selectedNode || selectedNode === '') return (<></>);

    const handleClose = (newpath) => {
        dispatch(hideDeleteNodeModal());
        if (newpath) {
            dispatch(hideNodeDetailsModal());
            navigate(newpath);
        }
    }

    const handleDeleteNodeAction = (data) => {

        //temporary disable delete button until response received
        setDisableDelete(true);

        requestDestroyLNDNode(data)
            .then(function (response) {
                enqueueSnackbar('Node Successfully Deleted', { variant: 'success', autoHideDuration: NotificationDuration });
                console.log(response);
                dispatch(hideDeleteNodeModal());
                dispatch(hideNodeDetailsModal());
                dispatch(removeNode(nodeDetailsModal.nodeName));
                //upon successful delete, unselect Node as globally selected Node
                if (globalSelectedNodeName === nodeDetailsModal.nodeName) {
                    dispatch(changeSelectedNode(nextSelectedNode(nodeReducer.nodeList, nodeDetailsModal.nodeName)));
                }

                setDisableDelete(false);
            }).catch(function (error) {
                enqueueSnackbar('Error occured when deleting node!', { variant: 'error', autoHideDuration: NotificationDuration });
                console.log(error);
                dispatch(hideDeleteNodeModal());

                setDisableDelete(false);
            });
    }

    const activateNode = () => {
        console.log('onActivate');
        dispatch(showActivateModal())
        dispatch(getSeeds(selectedNode))
    };

    return (
        <>
            <DeleteNodeComponent
                show={deleteNodeModalShow}
                disableDelete={disableDelete}
                node={selectedNode}
                goBack={handleClose}
                handleHide={handleClose}
                handleConfirm={(auth) => handleDeleteNodeAction({ ...auth, lndname: selectedNode.lndNodeName })}
                status={selectedNode.status}
                activateNodeAction={activateNode}
                {...rest}
            />
        </>
    );
};

export default DeleteNode;