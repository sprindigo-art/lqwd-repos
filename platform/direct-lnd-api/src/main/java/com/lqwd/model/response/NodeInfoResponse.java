package com.lqwd.model.response;

import com.lqwd.model.entities.LndNodeBalance;
import com.lqwd.model.entities.LndNodeDetail;
import lombok.Data;

@Data
public class NodeInfoResponse {
    private LndNodeBalance balance;
    private LndNodeDetail info;
}
