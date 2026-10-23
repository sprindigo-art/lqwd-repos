/* eslint-disable */
export const findNodeByName = (allNodeArray, nodeName) => {
  return !allNodeArray.isEmpty ? allNodeArray.find(item => item.lndNodeName === nodeName) : null;
};

export const nextSelectedNode = (allNodeArray, oldSelectedNode) => {
  const otherNode = allNodeArray.find(
    item => item.lndNodeName !== oldSelectedNode
  );
  if (otherNode) {
    return otherNode.lndNodeName;
  }
  return null;
};

export const findNodeInfosByName = (allNodeInfos, nodeName) => {
  return !allNodeInfos.isEmpty ? allNodeInfos.get(nodeName) : null;
};

export const getListOfNodeNames = allNodeArray => {
  return allNodeArray.map(a => a.lndNodeName);
};
