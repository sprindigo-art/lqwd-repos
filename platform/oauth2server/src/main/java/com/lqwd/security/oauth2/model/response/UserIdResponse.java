package com.lqwd.security.oauth2.model.response;

import com.lqwd.security.oauth2.model.security.Role_;
import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.model.security.User_Details;
import lombok.Builder;
import lombok.Data;

import java.io.Serializable;
import java.util.Collection;
import java.util.List;
import java.util.stream.Collectors;

@Data
@Builder
public class UserIdResponse implements Serializable {
    private String id;
}
