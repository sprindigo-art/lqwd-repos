package com.lqwd.interfaces;

import com.lqwd.model.DeployLNDPlus;
import com.lqwd.model.DeployNodeRequest;
import com.lqwd.model.DeployNodeResponse;
import com.lqwd.model.DestroyNodeRequest;
import com.lqwd.model.DestroyNodeResponse;

import java.io.IOException;

public interface LNDPlusDeployment {

    boolean deployLNDPlus(DeployLNDPlus request) throws IOException;

}
