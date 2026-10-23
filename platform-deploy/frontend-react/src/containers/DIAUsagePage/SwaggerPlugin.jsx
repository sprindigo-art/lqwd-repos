/* eslint-disable */
const ExtendingPlugin = function (system) {
  return {
    statePlugins: {
      extending: {
        actions: {
          doExtendedThings(...args) {
            // you can do other things in here if you want
            //   return system.normalActions.doStuff(...args)
            return alert();
          },
        },
      },
    },
  };
};

export default ExtendingPlugin;
