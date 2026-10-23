package com.lqwd.interfaces;

import com.lqwd.model.DeployNodeRequest;
import com.lqwd.model.DeployNodeResponse;
import com.lqwd.model.DestroyNodeRequest;
import com.lqwd.model.DestroyNodeResponse;
import com.lqwd.model.request.CreateLndNodeRequest;
import org.json.JSONObject;

import java.io.IOException;

public interface LNDDeploymentStrategy {

    DeployNodeResponse deploy(DeployNodeRequest request, CreateLndNodeRequest createLndNodeRequest, String token) throws IOException;

    DestroyNodeResponse destroy(DestroyNodeRequest request);

    String getAddress(JSONObject nodeInfo);
}
