package com.lqwd.model.request;

import com.lqwd.validators.ValidSaveLndFileRequest;
import lombok.Builder;
import lombok.Data;

@Data
@ValidSaveLndFileRequest
@Builder
public class LndFileItem {

    private String fileName;

    private String fileType;

    private String data;

    private Boolean encryptBeforeSave;

    private Boolean isUserFile = false;

}
