#pragma once

#include "desk/Settings.h"

#include "github/GitHubProvider.h"

namespace desk {

class GitHub {
public:
    void tick(const Settings& settings, bool online, bool timeValid);
    void invalidate() { data_ = {}; }
    const display::GitHubData& data() const { return data_; }

private:
    display::GitHubData data_;
    String username_;
    String proxy_;
    bool initialized_ = false;
    github::GitHubProvider provider_;
    char timestamp_[21] = {};
};

const char* githubStateName(display::GitHubState state);
const char* githubErrorMessage(const char* code);

}
