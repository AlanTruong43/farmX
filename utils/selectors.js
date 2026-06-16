/**
 * X.com CSS Selectors
 * Tập trung tất cả selectors tại đây — khi X thay đổi UI chỉ cần sửa file này
 * Cập nhật: 2026-03
 */

module.exports = {
    // ─── Compose Tweet ───────────────────────────────────────────────
    compose: {
        // Nút "Post" trên sidebar (mở compose)
        sidebarPostBtn: 'a[data-testid="SideNav_NewTweet_Button"]',
        // Text area trong compose dialog
        textArea: 'div[data-testid="tweetTextarea_0"]',
        // Fallback text area (contenteditable)
        textAreaFallback: 'div[role="textbox"][data-testid="tweetTextarea_0"]',
        // Nút Post (submit tweet)
        postBtn: 'button[data-testid="tweetButton"]',
        // Nút đính kèm media
        mediaBtn: 'input[data-testid="fileInput"]',
        // Close compose dialog
        closeBtn: 'button[data-testid="app-bar-close"]',
    },

    // ─── Tweet Actions (trên mỗi tweet) ─────────────────────────────
    tweet: {
        // Nút Like
        likeBtn: 'button[data-testid="like"]',
        // Nút Unlike (đã like rồi)
        unlikeBtn: 'button[data-testid="unlike"]',
        // Nút Retweet
        retweetBtn: 'button[data-testid="retweet"]',
        // Nút Unretweet
        unretweetBtn: 'button[data-testid="unretweet"]',
        // Confirm retweet trong dropdown
        retweetConfirm: 'div[data-testid="retweetConfirm"]',
        // Nút Reply
        replyBtn: 'button[data-testid="reply"]',
        // Nút Share
        shareBtn: 'button[data-testid="share"]',
        // Bookmark
        bookmarkBtn: 'button[data-testid="bookmark"]',
        // Avatar người đăng (click để mở popup profile)
        userAvatar: '[data-testid="Tweet-User-Avatar"]',
    },

    // ─── Reply ───────────────────────────────────────────────────────
    reply: {
        textArea: 'div[data-testid="tweetTextarea_0"]',
        replySubmitBtn: 'button[data-testid="tweetButton"]',
    },

    // ─── Theo dõi / Follow ───────────────────────────────────────────
    follow: {
        // Nút Follow trên profile page
        followBtn: 'button[data-testid$="-follow"]',
        // Nút Unfollow
        unfollowBtn: 'button[data-testid$="-unfollow"]',
        // Confirm unfollow dialog
        unfollowConfirm: 'button[data-testid="confirmationSheetConfirm"]',
    },

    // ─── Timeline / Feed ─────────────────────────────────────────────
    feed: {
        // Mỗi tweet article trong feed
        tweetArticle: 'article[data-testid="tweet"]',
        // Tab "For you"
        forYouTab: 'a[role="tab"][href="/home"]',
        // Tab "Following"  
        followingTab: 'a[role="tab"][href="/home/following"]',
        // Primary column
        primaryColumn: 'div[data-testid="primaryColumn"]',
    },

    // ─── Navigation ──────────────────────────────────────────────────
    nav: {
        home: 'a[data-testid="AppTabBar_Home_Link"]',
        explore: 'a[data-testid="AppTabBar_Explore_Link"]',
        notifications: 'a[data-testid="AppTabBar_Notifications_Link"]',
        messages: 'a[data-testid="AppTabBar_DirectMessage_Link"]',
        profile: 'a[data-testid="AppTabBar_Profile_Link"]',
    },

    // ─── Profile Page ────────────────────────────────────────────────
    profile: {
        displayName: 'div[data-testid="UserName"]',
        bio: 'div[data-testid="UserDescription"]',
        followersLink: 'a[href$="/verified_followers"]',
        followingLink: 'a[href$="/following"]',
    },

    // ─── Login (nếu bị logout) ───────────────────────────────────────
    login: {
        loginBtn: 'a[data-testid="loginButton"]',
        usernameInput: 'input[autocomplete="username"]',
        passwordInput: 'input[autocomplete="current-password"]',
        nextBtn: 'button[role="button"]:has-text("Next")',
        submitBtn: 'button[data-testid="LoginForm_Login_Button"]',
    },

    // ─── Chung ───────────────────────────────────────────────────────
    common: {
        // Toast notification (xác nhận action thành công)
        toast: 'div[data-testid="toast"]',
        // Loading spinner
        spinner: 'div[role="progressbar"]',
        // Modal overlay
        modal: 'div[data-testid="sheetDialog"]',
    },
};
